import type { Config } from '../config.js';
import { WallosClient } from '../wallos/client.js';
import { loadContext, normalize, resolve, summary } from './catalog.js';
import { fail, success } from './errors.js';
import { costPolicy, costSubtotals, Money } from './costs.js';
import { digest } from './identity.js';
import type { ToolInput, ToolName } from '../tools/contracts.js';

export class ReadService {
  constructor(readonly api: WallosClient, readonly config: Config) {}
  context() { return loadContext(this.api, this.config); }
  async detail(id: string) { const [raw, ctx] = await Promise.all([this.api.subscription(id), this.context()]); return normalize(raw, ctx); }
  async all() {
    const [rows, context] = await Promise.all([this.api.subscriptions(), this.context()]);
    return { context, subscriptions: await Promise.all(rows.map(r => normalize(r, context))) };
  }
  async search(input: ToolInput<'wallos_search_subscriptions'>) {
    const { context, subscriptions } = await this.all();
    const category = input.category ? resolve(input.category, context.categories, '分类').id : undefined;
    const payer = input.payer_member ? resolve(input.payer_member, context.payer_members, '付款人').id : undefined;
    const method = input.payment_method ? resolve(input.payment_method, context.payment_methods, '付款方式').id : undefined;
    const matches = subscriptions.filter(s => (!input.query || s.name.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()))
      && (input.tracking_state === 'all' || s.tracking_state === input.tracking_state)
      && (!category || s.category?.id === category) && (!payer || s.payer_member?.id === payer) && (!method || s.payment_method?.id === method))
      .sort((a, b) => Number(a.subscription_id) - Number(b.subscription_id));
    // Cursor binds the full query and current result snapshot. Changed records trigger an explicit restart.
    const { cursor, ...query } = input;
    const fingerprint = await digest({ query, records: matches.map(s => [s.subscription_id, s.version]) });
    let offset = 0;
    if (cursor) {
      const m = /^([a-f0-9]{64}):(\d+)$/.exec(cursor);
      if (!m || m[1] !== fingerprint || !Number.isSafeInteger(Number(m[2])) || Number(m[2]) > matches.length) fail('STALE_CURSOR', '分页游标失效；查询参数或记录已变化。', { resolution: '移除 cursor 从第一页重新查询。' });
      offset = Number(m[2]);
    }
    const next = offset + input.limit;
    return success({ items: matches.slice(offset, next).map(summary), total_matches: matches.length, next_cursor: next < matches.length ? `${fingerprint}:${next}` : null }, [], next < matches.length || offset > 0 ? 'partial' : 'complete');
  }
  async upcoming(input: ToolInput<'wallos_list_upcoming_payments'>) {
    const { subscriptions } = await this.all();
    return success({ ...input, coverage: 'next_payment_only' as const, items: subscriptions.filter(s => s.tracking_state === 'active' && s.next_payment_date >= input.from && s.next_payment_date <= input.to).sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date) || Number(a.subscription_id) - Number(b.subscription_id)).map(summary) }, [], 'next_payment_only');
  }
  async costs(input: ToolInput<'wallos_summarize_costs'>) {
    const { context, subscriptions } = await this.all();
    const active = subscriptions.filter(s => s.tracking_state === 'active');
    const subtotals = costSubtotals(active, input.basis, input.month);
    const warnings: string[] = [];
    const total = subtotals.length > 1 ? null : subtotals[0] ?? { amount: '0.00', currency: context.default_currency };
    if (!total) warnings.push('缺少可验证的汇率日期；返回原币小计，未合并币种。');
    if (input.basis === 'scheduled_payments') {
      const upstream = await this.api.monthly(input.month!);
      if (active.some(s => ['month', 'year'].includes(s.billing.unit) && Number(s.next_payment_date.slice(8)) >= 29))
        warnings.push('包含月末或闰日账期；上游日期溢出算法可能将付款移出目标月。本结果复现 Wallos 月费用口径，不是完整预测。');
      warnings.push('采用 Wallos 月费用算法；开始日期和手动续费不构成实际交易证据。');
      if (upstream.notes?.length) warnings.push('上游月费用接口返回了提示；未采用跨币种总额。');
      if (total && total.currency === upstream.currency_code && !new Money(total.amount).eq(upstream.monthly_cost))
        fail('COST_CONTRACT_MISMATCH', '本地原币月费用与 Wallos 月费用不一致。', { resolution: '核对部署版本的日期算法与响应契约。' });
    }
    return success({ basis: input.basis, month: input.month ?? null, subtotals, total, exchange_rate_date: null,
      policy: input.basis === 'scheduled_payments' ? costPolicy.scheduled_payments : costPolicy.monthly_equivalent, subscription_count: active.length }, warnings);
  }
  async invoke(name: ToolName, input: unknown): Promise<unknown> {
    switch (name) {
      case 'wallos_get_context': return success(await this.context());
      case 'wallos_get_subscription': return success(await this.detail((input as ToolInput<'wallos_get_subscription'>).subscription_id));
      case 'wallos_search_subscriptions': return this.search(input as ToolInput<'wallos_search_subscriptions'>);
      case 'wallos_list_upcoming_payments': return this.upcoming(input as ToolInput<'wallos_list_upcoming_payments'>);
      case 'wallos_summarize_costs': return this.costs(input as ToolInput<'wallos_summarize_costs'>);
      default: return fail('INVALID_TOOL', '此工具不是读取工具。');
    }
  }
}
