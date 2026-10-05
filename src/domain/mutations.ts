import type { Config } from '../config';
import { WallosClient, type Form } from '../wallos/client';
import { currencyId, loadContext, normalize, resolve } from './catalog';
import { fail, success } from './errors';
import { digest } from './identity';
import type { Context, Patch, Subscription } from './schema';
import type { RawSubscription } from '../wallos/schema';
import type { ToolInput, ToolName } from '../tools/contracts';
import { Money } from './costs';
export interface PreparedMutation { action: 'add' | 'edit'; form: Form; before: Subscription | null; rawVersion: string | null }

const cycle = { day: '1', week: '2', month: '3', year: '4' };
function encodeChanges(changes: Patch, ctx: Context): Form {
  const form: Form = {};
  if (changes.name !== undefined) form.name = changes.name;
  if (changes.price) { form.price = changes.price.amount; form.currency_id = currencyId(changes.price.currency, ctx); }
  if (changes.billing) { form.frequency = String(changes.billing.interval); form.cycle = cycle[changes.billing.unit]; }
  if (changes.start_date !== undefined) form.start_date = changes.start_date;
  if (changes.next_payment_date !== undefined) form.next_payment = changes.next_payment_date;
  if (changes.renewal !== undefined) form.auto_renew = changes.renewal === 'automatic' ? '1' : '0';
  for (const [key, rows, field, label] of [
    ['category', ctx.categories, 'category_id', '分类'], ['payer_member', ctx.payer_members, 'payer_user_id', '付款人'],
    ['payment_method', ctx.payment_methods, 'payment_method_id', '付款方式'],
  ] as const) {
    const ref = changes[key];
    if (ref !== undefined) form[field] = ref === null ? '' : resolve(ref, rows, label).id;
  }
  if (changes.notes !== undefined) form.notes = changes.notes ?? '';
  if (changes.url !== undefined) form.url = changes.url ?? '';
  return form;
}
function flatten(obj: unknown, prefix = '', out: Record<string, string | number | boolean | null> = {}) {
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) if (k !== 'version') flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = obj as string | number | boolean | null;
  return out;
}
export function diff(before: Subscription | null, after: Subscription) {
  const old = before ? flatten(before) : {}, current = flatten(after);
  const changes: Record<string, { before: string | number | boolean | null; after: string | number | boolean | null }> = {};
  const unchanged: string[] = [];
  for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
    const a = old[key] ?? null, b = current[key] ?? null;
    if (a !== b) changes[key] = { before: a, after: b }; else unchanged.push(key);
  }
  return { changes, unchanged };
}
export class MutationService {
  constructor(readonly api: WallosClient, readonly config: Config) {}
  async prepare(name: ToolName, input: unknown): Promise<PreparedMutation> {
    const ctx = await loadContext(this.api, this.config);
    if (name === 'wallos_create_subscription') {
      const s = (input as ToolInput<'wallos_create_subscription'>).subscription;
      return { action: 'add', before: null, rawVersion: null, form: { ...encodeChanges(s, ctx), inactive: '0', notify: '0' } };
    }
    const base = input as ToolInput<'wallos_update_subscription'>;
    const raw = await this.api.subscription(base.subscription_id);
    const before = await normalize(raw, ctx);
    if (before.version !== base.expected_version) fail('VERSION_CONFLICT', '记录已变化；尚未写入。', { subscription_id: base.subscription_id, resolution: '重新读取详情并审阅后，以新的 request_id 和 expected_version 提交。' });
    const form: Form = { id: base.subscription_id };
    switch (name) {
      case 'wallos_update_subscription': Object.assign(form, encodeChanges(base.changes, ctx)); break;
      case 'wallos_set_tracking_state': {
        const state = input as ToolInput<'wallos_set_tracking_state'>;
        form.inactive = state.tracking_state === 'inactive' ? '1' : '0';
        if (state.cancellation_date !== undefined) form.cancellation_date = state.cancellation_date ?? '';
        break;
      }
      case 'wallos_set_subscription_reminder': {
        const reminder = input as ToolInput<'wallos_set_subscription_reminder'>;
        form.notify = reminder.enabled ? '1' : '0';
        if (reminder.days_before !== undefined) form.notify_days_before = reminder.days_before === null ? '' : String(reminder.days_before);
        break;
      }
      default: fail('INVALID_TOOL', '此工具不是单条写入工具。');
    }
    const start = form.start_date ?? before.start_date;
    const next = form.next_payment ?? before.next_payment_date;
    if (start && next < start) fail('INVALID_DATES', '下一次付款日期早于开始日期；尚未写入。');
    return { action: 'edit', before, rawVersion: before.version, form };
  }
  async checkVersion(prepared: PreparedMutation) {
    if (prepared.action === 'edit') {
      const raw = await this.api.subscription(prepared.form.id);
      if (await digest(raw) !== prepared.rawVersion) fail('VERSION_CONFLICT', '提交前记录已变化；尚未写入。', { resolution: '重新读取记录并使用新的 request_id。' });
    }
  }
  async verify(prepared: PreparedMutation, id: string, requestId: string) {
    const raw = await this.api.subscription(id);
    for (const [field, expected] of Object.entries(prepared.form)) {
      if (field === 'id') continue;
      const actual = raw[field as keyof RawSubscription];
      const same = field === 'price' ? new Money(String(actual)).eq(expected)
        : typeof actual === 'boolean' ? actual === (expected === '1')
        : String(actual ?? '') === expected;
      if (!same) fail('WRITE_OUTCOME_UNKNOWN', '写后读取与请求不一致；写入可能已发生。', { request_id: requestId, subscription_id: id, resolution: '使用详情工具核对实际记录；保持 request_id，不重复创建。' });
    }
    const context = await loadContext(this.api, this.config);
    const after = await normalize(raw, context);
    const warnings = [
      '仅修改 Wallos 记录，未联系服务商或改变真实扣款。',
      '冲突检测与账户内串行写入不覆盖 Wallos 网页写入，不提供上游原子比较更新。',
    ];
    if (prepared.form.notify !== undefined) {
      warnings.push('提醒配置已保存；通知送达未验证。');
      if (raw.notify && context.reminder.enabled_channels.length === 0) warnings.push('当前账户没有已启用的提醒通道。');
    }
    return success({ request_id: requestId, subscription: after, ...diff(prepared.before, after), verified: true as const }, warnings);
  }
}
