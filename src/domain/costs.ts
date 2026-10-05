import { Decimal } from 'decimal.js';
import type { Subscription } from './schema';
import { fail } from './errors';
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const dayMs = 86400000;
function step(date: Date, s: Subscription, direction: number) {
  const n = direction * s.billing.interval;
  const d = new Date(date);
  switch (s.billing.unit) {
    case 'day': d.setUTCDate(d.getUTCDate() + n); break;
    case 'week': d.setUTCDate(d.getUTCDate() + n * 7); break;
    case 'month': d.setUTCMonth(d.getUTCMonth() + n); break;
    case 'year': d.setUTCFullYear(d.getUTCFullYear() + n); break;
  }
  return d;
}
// Reproduces get_monthly_cost.php's calendar overflow semantics, without returning a full forecast.
export function monthlyOccurrences(s: Subscription, month: string) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  let d = new Date(`${s.next_payment_date}T00:00:00Z`);
  if (s.billing.unit === 'day' || s.billing.unit === 'week') {
    const stride = s.billing.interval * (s.billing.unit === 'week' ? 7 : 1) * dayMs;
    d = new Date(d.getTime() + Math.floor((start.getTime() - d.getTime()) / stride) * stride);
  } else {
    let iterations = 0;
    while (d > start) {
      if (++iterations > 10000) fail('COST_LIMIT_EXCEEDED', '月费用账期迭代超过上限。');
      d = step(d, s, -1);
    }
  }
  let count = 0, iterations = 0;
  while (d < end) {
    if (++iterations > 10000) fail('COST_LIMIT_EXCEEDED', '月费用账期迭代超过上限。');
    if (d >= start) count++;
    d = step(d, s, 1);
  }
  return count;
}
export function costSubtotals(subscriptions: Subscription[], basis: 'scheduled_payments' | 'monthly_equivalent', month?: string) {
  const totals = new Map<string, InstanceType<typeof Money>>();
  for (const s of subscriptions.filter(s => s.tracking_state === 'active')) {
    let cost = new Money(s.price.amount);
    if (basis === 'scheduled_payments') cost = cost.times(monthlyOccurrences(s, month!));
    else {
      const factor = { day: new Money(30), week: new Money(30).div(7), month: new Money(1), year: new Money(1).div(12) }[s.billing.unit];
      cost = cost.times(factor).div(s.billing.interval);
    }
    totals.set(s.price.currency, (totals.get(s.price.currency) ?? new Money(0)).plus(cost));
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));
}
export const costPolicy = {
  version: 'phase-2-v1', monthly_equivalent: '日付按30天/月、周付按30/7周/月、月付按1月、年付按1/12年折算；先汇总再保留两位小数。',
  scheduled_payments: '依 get_monthly_cost.php：以 next_payment 为锚点回退至月初，再按日/周/月/年累计；月末和闰年按 PHP 日期溢出规则。只纳入启用记录，沿用上游对开始日期和手动续费的处理。不是实际交易。',
  upcoming_payments: '只列记录中的下一次付款；coverage=next_payment_only，不展开重复账期。',
  conversion: '读取接口缺少可验证的账户汇率日期；跨币种仅返回原币小计，total=null，不自动换算。',
};
