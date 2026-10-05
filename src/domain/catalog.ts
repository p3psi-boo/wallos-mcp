import type { Config } from '../config.js';
import { WallosClient } from '../wallos/client.js';
import { fail } from './errors.js';
import { digest } from './identity.js';
import { Decimal } from 'decimal.js';
import type { RawSubscription } from '../wallos/schema.js';
import type { Context, Ref, Subscription } from './schema.js';

export async function loadContext(api: WallosClient, config: Config): Promise<Context> {
  const [currency, categories, members, methods, reminder] = await Promise.all([api.currencies(), api.categories(), api.members(), api.paymentMethods(), api.notifications()]);
  const main = currency.currencies.find(c => c.id === currency.main_currency);
  if (!main) fail('UPSTREAM_SCHEMA_ERROR', '默认币种不在账户币种列表中。');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const named = (row: { id: string; name: string }) => ({ id: row.id, name: row.name });
  return { timezone: config.timezone, today: `${part('year')}-${part('month')}-${part('day')}`, default_currency: main.code,
    currencies: currency.currencies.map(c => ({ ...named(c), code: c.code })), categories: categories.map(named), payer_members: members.map(named),
    payment_methods: methods.filter(m => m.enabled !== false).map(named), reminder };
}
export function resolve(ref: Ref, rows: { id: string; name: string }[], kind: string) {
  if (ref.id) {
    const row = rows.find(r => r.id === ref.id);
    if (!row) fail('REFERENCE_NOT_FOUND', `${kind} ID 不在当前账户可用对象中。`);
    if (ref.name !== undefined && row.name !== ref.name) fail('REFERENCE_MISMATCH', `${kind} ID 与名称不一致。`);
    return row;
  }
  const matches = rows.filter(r => r.name === ref.name);
  if (matches.length === 0) fail('REFERENCE_NOT_FOUND', `${kind}没有精确匹配对象。`, { resolution: '先读取 wallos_get_context，再选择已有对象。' });
  if (matches.length > 1) fail('AMBIGUOUS_REFERENCE', `${kind}名称对应多个对象；尚未写入。`, { candidates: matches, resolution: '按 ID 选择对象。' });
  return matches[0];
}
export function currencyId(code: string, context: Context) {
  const matches = context.currencies.filter(c => c.code === code);
  if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_CURRENCY' : 'CURRENCY_NOT_FOUND', '币种代码需在当前账户中唯一存在。', { candidates: matches.map(c => ({ id: c.id, name: c.name })) });
  return matches[0].id;
}
export async function normalize(raw: RawSubscription, context: Context): Promise<Subscription> {
  const currency = context.currencies.find(c => c.id === raw.currency_id);
  if (!currency) fail('UPSTREAM_SCHEMA_ERROR', '订阅引用了未知币种。');
  const named = (id: string | null, rows: { id: string; name: string }[]) => id === null ? null : rows.find(r => r.id === id) ?? { id, name: '[不可用对象]' };
  return { subscription_id: raw.id, name: raw.name, tracking_state: raw.inactive ? 'inactive' : 'active',
    price: { amount: new Decimal(raw.price).toFixed(), currency: currency.code },
    billing: { interval: raw.frequency, unit: (['day', 'week', 'month', 'year'] as const)[raw.cycle - 1] },
    next_payment_date: raw.next_payment, start_date: raw.start_date, category: named(raw.category_id, context.categories),
    payer_member: named(raw.payer_user_id, context.payer_members), payment_method: named(raw.payment_method_id, context.payment_methods),
    notes: raw.notes, url: raw.url, renewal: raw.auto_renew ? 'automatic' : 'manual', cancellation_date: raw.cancellation_date,
    reminder: { enabled: raw.notify, days_before: raw.notify_days_before }, version: await digest(raw) };
}
export function summary(s: Subscription) {
  const { start_date, notes, url, renewal, cancellation_date, reminder, ...rest } = s;
  return rest;
}
