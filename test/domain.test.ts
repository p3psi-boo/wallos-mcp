import { describe, it, expect } from 'vitest';
import { WallosClient } from '../src/wallos/client';
import { ReadService } from '../src/domain/reads';
import { MutationService } from '../src/domain/mutations';
import { OperationRunner } from '../src/operations/runner';
import { contracts } from '../src/tools/contracts';
import { costSubtotals, monthlyOccurrences } from '../src/domain/costs';
import { normalize } from '../src/domain/catalog';
import { BusinessError } from '../src/domain/errors';
import { Fixture, MemoryStore, config, raw } from './fixture';
function harness() {
  const fixture = new Fixture(), store = new MemoryStore();
  const api = new WallosClient(config, fixture.fetch), reads = new ReadService(api, config), mutations = new MutationService(api, config);
  const runner = new OperationRunner(store, mutations);
  return { fixture, store, api, reads, mutations, runner };
}
const createInput = () => contracts.wallos_create_subscription.input.parse({ request_id: 'create-001', subscription: {
  name: '年付云盘', price: { amount: '1200.00', currency: 'CNY' }, billing: { interval: 1, unit: 'year' },
  start_date: '2026-11-01', next_payment_date: '2026-11-01', category: { name: '云存储' }, payer_member: { name: '本人' }, payment_method: { name: '支付宝' },
} });
describe('read and semantic layer', () => {
  it('strips private account data and treats subscription notes as data', async () => {
    const h = harness(); const context = await h.reads.context();
    expect(context.reminder.enabled_channels).toEqual(['email', 'webhook']);
    expect(JSON.stringify(context)).not.toMatch(/LEAK|smtp|private@example|hidden|secret/);
    const s = await h.reads.detail('42'); expect(s.notes).toContain('仅数据');
    expect(h.fixture.writes).toHaveLength(0);
    expect((await h.reads.search(contracts.wallos_search_subscriptions.input.parse({}))).data.items[0]).not.toHaveProperty('notes');
  });
  it('returns all same-name candidates and binds pagination to a snapshot', async () => {
    const h = harness(); h.fixture.rows.push(raw({ id: '57' }));
    const query = contracts.wallos_search_subscriptions.input.parse({ query: '云盘', limit: 1 });
    const a = await h.reads.search(query); expect(a.data.total_matches).toBe(2); expect(a.meta.coverage).toBe('partial');
    const b = await h.reads.search({ ...query, cursor: a.data.next_cursor! }); expect(b.data.items[0].subscription_id).toBe('57');
    h.fixture.rows[0].price = '21';
    await expect(h.reads.search({ ...query, cursor: a.data.next_cursor! })).rejects.toMatchObject({ detail: { code: 'STALE_CURSOR' } });
  });
  it('next payment has limited coverage, no recurrence expansion', async () => {
    const h = harness(); h.fixture.rows[0] = raw({ cycle: 2, next_payment: '2026-11-02' });
    const r = await h.reads.upcoming({ from: '2026-11-01', to: '2026-11-30' });
    expect(r.data.items).toHaveLength(1); expect(r.meta.coverage).toBe('next_payment_only');
  });
  it('distinguishes annual scheduled payment and monthly average', async () => {
    const h = harness(); h.fixture.rows[0] = raw({ price: '1200', cycle: 4 });
    expect((await h.reads.costs({ basis: 'scheduled_payments', month: '2026-11' })).data.total?.amount).toBe('1200.00');
    expect((await h.reads.costs({ basis: 'scheduled_payments', month: '2026-10' })).data.total?.amount).toBe('0.00');
    expect((await h.reads.costs({ basis: 'monthly_equivalent' })).data.total?.amount).toBe('100.00');
  });
  it('never adds mixed currencies under one currency label', async () => {
    const h = harness(); h.fixture.rows.push(raw({ id: '43', currency_id: '2', price: '10' }));
    for (const input of [{ basis: 'monthly_equivalent' as const }, { basis: 'scheduled_payments' as const, month: '2026-11' }]) {
      const r = await h.reads.costs(input); expect(r.data.total).toBeNull(); expect(r.data.subtotals).toEqual([{ currency: 'CNY', amount: '19.90' }, { currency: 'USD', amount: '10.00' }]);
    }
  });
  it('uses decimal arithmetic before rounding', async () => {
    const h = harness(); h.fixture.rows = [raw({ price: '0.1' }), raw({ id: '43', price: '0.2' })];
    expect((await h.reads.costs({ basis: 'monthly_equivalent' })).data.total?.amount).toBe('0.30');
  });
  it('validates dates, empty patches, URL scheme and disjoint write fields', () => {
    expect(contracts.wallos_list_upcoming_payments.input.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(contracts.wallos_list_upcoming_payments.input.safeParse({ from: '2024-02-29', to: '2024-03-01' }).success).toBe(true);
    for (const changes of [{}, { inactive: true }, { reminder: { enabled: true } }, { url: 'file:///etc/passwd' }, { notes: 'x', api_key: 'x' }]) {
      expect(contracts.wallos_update_subscription.input.safeParse({ request_id: 'update-1', subscription_id: '42', expected_version: 'a'.repeat(64), changes }).success).toBe(false);
    }
    expect(contracts.wallos_summarize_costs.input.safeParse({ basis: 'scheduled_payments' }).success).toBe(false);
    expect(contracts.wallos_summarize_costs.input.safeParse({ basis: 'monthly_equivalent', month: '2026-11' }).success).toBe(false);
  });
});
describe('phase two writes', () => {
  it('creates once, persists and replays verified results after reconstruction', async () => {
    const h = harness(), input = createInput();
    const r = await h.runner.run('wallos_create_subscription', input);
    expect(contracts.wallos_create_subscription.output.parse(r).data?.verified).toBe(true);
    const next = new OperationRunner(h.store, h.mutations);
    expect(await next.run('wallos_create_subscription', input)).toEqual(r);
    expect(h.fixture.writes).toHaveLength(1); expect(h.fixture.rows).toHaveLength(2);
  });
  it('detects request ID reuse with different contents or tool', async () => {
    const h = harness(); const input = createInput();
    await h.runner.run('wallos_create_subscription', input);
    const r = await h.runner.run('wallos_create_subscription', { ...input, subscription: { ...input.subscription, name: 'different' } });
    expect(r).toMatchObject({ ok: false, error: { code: 'REQUEST_ID_CONFLICT' } }); expect(h.fixture.writes).toHaveLength(1);
  });
  it('serializes concurrent duplicates', async () => {
    const h = harness(); const input = createInput();
    const results = await Promise.all(Array.from({ length: 5 }, () => h.runner.run('wallos_create_subscription', input)));
    expect(results.every(r => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true); expect(h.fixture.writes).toHaveLength(1);
  });
  it('only submits price and currency when updating a price', async () => {
    const h = harness(); const before = await h.reads.detail('42');
    const r = await h.runner.run('wallos_update_subscription', { request_id: 'update-001', subscription_id: '42', expected_version: before.version, changes: { price: { amount: '25.00', currency: 'CNY' } } });
    const result = contracts.wallos_update_subscription.output.parse(r); expect(result.ok).toBe(true);
    expect(result.data?.changes).toEqual({ 'price.amount': { before: '19.9', after: '25' } });
    expect(result.data?.subscription.notes).toBe(before.notes); expect(result.data?.subscription.billing).toEqual(before.billing);
    expect([...h.fixture.writes[0].keys()].sort()).toEqual(['action', 'api_key', 'currency_id', 'id', 'price']);
  });
  it('null clears selected fields; omission preserves all others', async () => {
    const h = harness(); const before = await h.reads.detail('42');
    const r = await h.runner.run('wallos_update_subscription', { request_id: 'clear-001', subscription_id: '42', expected_version: before.version, changes: { notes: null, category: null } });
    const result = contracts.wallos_update_subscription.output.parse(r);
    expect(result.data?.subscription.notes).toBe(''); expect(result.data?.subscription.category).toBeNull(); expect(result.data?.subscription.url).toBe(before.url);
    expect(h.fixture.writes[0].get('category_id')).toBe(''); expect(h.fixture.writes[0].has('url')).toBe(false);
  });
  it('returns ambiguous references, mismatched IDs, or missing references without writes', async () => {
    const h = harness(); h.fixture.categories.push({ id: 2, name: '云存储', user_id: 1 });
    const r = await h.runner.run('wallos_create_subscription', createInput());
    expect(r).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_REFERENCE', candidates: [{ id: '1' }, { id: '2' }] } });
    const input = createInput(); input.request_id = 'create-002'; input.subscription.category = { id: '1', name: 'wrong' };
    expect(await h.runner.run('wallos_create_subscription', input)).toMatchObject({ ok: false, error: { code: 'REFERENCE_MISMATCH' } });
    expect(h.fixture.writes).toHaveLength(0);
  });
  it('detects webpage changes before writing', async () => {
    const h = harness(); const before = await h.reads.detail('42'); h.fixture.rows[0].notes = 'changed on webpage';
    const r = await h.runner.run('wallos_update_subscription', { request_id: 'conflict-1', subscription_id: '42', expected_version: before.version, changes: { name: 'new' } });
    expect(r).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } }); expect(h.fixture.writes).toHaveLength(0);
  });
  it('does not resend create after timeout or malformed successful response', async () => {
    for (const mode of ['loseWriteResponse', 'badWriteResponse'] as const) {
      const h = harness(); h.fixture[mode] = true; const input = createInput();
      expect(await h.runner.run('wallos_create_subscription', input)).toMatchObject({ ok: false, error: { code: 'WRITE_OUTCOME_UNKNOWN' } });
      const next = new OperationRunner(h.store, h.mutations);
      expect(await next.run('wallos_create_subscription', input)).toMatchObject({ ok: false, error: { code: 'WRITE_OUTCOME_UNKNOWN' } });
      expect(h.fixture.writes).toHaveLength(1); expect(h.fixture.rows).toHaveLength(2);
    }
  });
  it('reconciles a known ID after verification becomes available, without resending', async () => {
    const h = harness(); h.fixture.failVerify = true; const input = createInput();
    expect(await h.runner.run('wallos_create_subscription', input)).toMatchObject({ ok: false, error: { code: 'WRITE_OUTCOME_UNKNOWN', subscription_id: '43' } });
    h.fixture.failVerify = false;
    const next = new OperationRunner(h.store, h.mutations);
    expect(await next.run('wallos_create_subscription', input)).toMatchObject({ ok: true, data: { verified: true } }); expect(h.fixture.writes).toHaveLength(1);
  });
  it('does not echo upstream error messages containing secrets', async () => {
    const h = harness(); h.fixture.rejectWrite = true;
    const r = await h.runner.run('wallos_create_subscription', createInput()); expect(r).toMatchObject({ ok: false, error: { code: 'UPSTREAM_REJECTED' } });
    expect(JSON.stringify(r)).not.toContain(config.apiKey);
  });
  it('tracking state and reminder have dedicated write scopes and semantics', async () => {
    const h = harness(); const before = await h.reads.detail('42');
    const state = await h.runner.run('wallos_set_tracking_state', { request_id: 'state-001', subscription_id: '42', expected_version: before.version, tracking_state: 'inactive' });
    const result = contracts.wallos_set_tracking_state.output.parse(state); expect(result.data?.subscription.tracking_state).toBe('inactive'); expect(result.warnings?.join()).toContain('未联系服务商');
    const after = await h.reads.detail('42');
    const reminder = await h.runner.run('wallos_set_subscription_reminder', { request_id: 'reminder-001', subscription_id: '42', expected_version: after.version, enabled: true, days_before: 0 });
    const updated = contracts.wallos_set_subscription_reminder.output.parse(reminder); expect(updated.data?.subscription.reminder).toEqual({ enabled: true, days_before: 0 }); expect(updated.warnings?.join()).toContain('送达未验证');
    expect(h.fixture.writes[1].has('inactive')).toBe(false);
  });
});
describe('recovery and calendar contract edges', () => {
  it('serializes two different writes to a record and rejects the second stale version', async () => {
    const h = harness(); const s = await h.reads.detail('42');
    const input = { subscription_id: '42', expected_version: s.version, changes: { name: 'first' }, request_id: 'parallel-001' };
    const [a, b] = await Promise.all([
      h.runner.run('wallos_update_subscription', input),
      h.runner.run('wallos_update_subscription', { ...input, request_id: 'parallel-002', changes: { name: 'second' } }),
    ]);
    expect(a).toMatchObject({ ok: true }); expect(b).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } }); expect(h.fixture.writes).toHaveLength(1);
  });
  it('reconciles an edit response loss via known ID without another edit', async () => {
    const h = harness(); const s = await h.reads.detail('42'); h.fixture.loseWriteResponse = true;
    const input = { request_id: 'lost-edit-001', subscription_id: '42', expected_version: s.version, changes: { name: 'renamed' } };
    expect(await h.runner.run('wallos_update_subscription', input)).toMatchObject({ ok: false, error: { code: 'WRITE_OUTCOME_UNKNOWN' } });
    const next = new OperationRunner(h.store, h.mutations);
    expect(await next.run('wallos_update_subscription', input)).toMatchObject({ ok: true, data: { subscription: { name: 'renamed' } } });
    expect(h.fixture.writes).toHaveLength(1);
  });
  it('preexisting dispatch record without an ID is never replayed after a crash', async () => {
    const h = harness(); const input = createInput();
    const { digest } = await import('../src/domain/identity');
    await h.store.put('operation:create-001', { fingerprint: await digest({ tool: 'wallos_create_subscription', input }), state: 'dispatching', tool: 'wallos_create_subscription', started_at: new Date().toISOString() });
    expect(await h.runner.run('wallos_create_subscription', input)).toMatchObject({ ok: false, error: { code: 'WRITE_OUTCOME_UNKNOWN' } });
    expect(h.fixture.writes).toHaveLength(0);
  });
  it('PHP-style leap/year rollover differs from clamping and is explicit', async () => {
    const h = harness(); const ctx = await h.reads.context();
    const yearly = await normalize(raw({ cycle: 4, next_payment: '2028-02-29' }), ctx);
    expect(monthlyOccurrences(yearly, '2028-02')).toBe(0);
    expect(monthlyOccurrences(yearly, '2028-03')).toBe(0);
    expect(monthlyOccurrences(yearly, '2027-02')).toBe(0);
    expect(monthlyOccurrences(yearly, '2027-03')).toBe(1);
    const daily = await normalize(raw({ cycle: 1, next_payment: '2028-03-01' }), ctx);
    expect(monthlyOccurrences(daily, '2028-02')).toBe(29);
    expect(monthlyOccurrences(daily, '2027-02')).toBe(28);
  });
  it('read schema mismatch is explicit and missing records never mutate', async () => {
    const h = harness();
    await expect(h.reads.detail('999')).rejects.toMatchObject({ detail: { code: 'NOT_FOUND' } });
    h.fixture.rows[0].frequency = 0;
    await expect(h.reads.detail('42')).rejects.toMatchObject({ detail: { code: 'UPSTREAM_SCHEMA_ERROR' } }); expect(h.fixture.writes).toHaveLength(0);
  });
});
