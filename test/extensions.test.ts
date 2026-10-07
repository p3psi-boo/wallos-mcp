import { describe, expect, it } from 'vitest';
import { WallosAccount } from '../src/account';
import { WallosClient, paths } from '../src/wallos/client';
import { contracts } from '../src/tools/contracts';
import { Confirmation } from '../src/domain/confirmation';
import { isPublicAddress } from '../src/domain/media';
import { digest } from '../src/domain/identity';
import { readConfig } from '../src/config';
import { ExtendedFixture } from './extended-fixture';
import { config, raw } from './fixture';
const configured = { ...config, confirmationKey: 'confirmation-key-with-at-least-32-characters', configurationTools: true, secrets: { fixer: 'SECRET-FIXER', smtp: 'SECRET-SMTP', oidc: 'SECRET-OIDC-NEW' } };
function harness(configurationTools = true) {
  const fixture = new ExtendedFixture(); const cfg = { ...configured, configurationTools };
  const api = new WallosClient(cfg, fixture.fetch); const account = new WallosAccount(cfg, api);
  const call = async (name: keyof typeof contracts, input: unknown = {}) => {
    const result = await account.invoke(name, input); contracts[name].output.parse(result); return result as any;
  };
  return { fixture, api, account, call };
}
const request_id = 'extension-test-001';
describe('references and profile/calendar', () => {
  it('exposes management metadata, disabled methods and reference versions without private context fields', async () => {
    const h = harness(); h.fixture.references.payment_method.push({ id: '2', name: 'Disabled', enabled: false, in_use: false, order: 2 });
    const r = await h.call('wallos_get_context'); expect(r.ok).toBe(true);
    expect(r.data.payment_methods[1]).toMatchObject({ enabled: false, order: 2, in_use: false, version: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain('private@example');
    const invalid = await h.call('wallos_update_subscription', { request_id, subscription_id: '42', expected_version: await digest(h.fixture.base.rows[0]), changes: { payment_method: { id: '2' } } });
    expect(invalid.error.code).toBe('REFERENCE_DISABLED');
  });
  it.each(['category','household_member','payment_method','currency'] as const)('creates and partially edits %s with strict kind fields', async kind => {
    const h = harness();
    const data = kind === 'currency' ? { name: 'Euro', code: 'EUR', symbol: '€', rate: '0.1' } : kind === 'household_member' ? { name: 'New', email: 'new@example.test' } : kind === 'payment_method' ? { name: 'New', enabled: false } : { name: 'New' };
    const created = await h.call('wallos_create_reference', { kind, request_id, data }); expect(created.ok).toBe(true);
    const reference = created.data.reference;
    const changes = kind === 'currency' ? { rate: '0.2' } : kind === 'household_member' ? { email: 'changed@example.test' } : { name: 'Changed' };
    const updated = await h.call('wallos_update_reference', { kind, request_id, id: reference.id, expected_version: reference.version, changes });
    expect(updated.ok).toBe(true); expect(updated.data.reference).toMatchObject(changes);
    const wire = [...h.fixture.calls].reverse().find(c => c.form.get('action') === 'edit')!;
    if (kind === 'currency') expect(wire.form.get('symbol')).toBe('€');
    expect(wire.multipart).toBe(kind === 'payment_method');
    const invalid = await h.call('wallos_create_reference', { kind: 'category', request_id, data: { name: 'New', email: 'x@example.test' } }); expect(invalid.error.code).toBe('INVALID_INPUT');
  });
  it('category writes use PHP form contract and never API-key URLs', async () => {
    const h = harness(); await h.call('wallos_create_reference', { kind: 'category', request_id, data: { name: 'New' } });
    const call = h.fixture.calls.find(c => c.path === paths.setCategories)!; expect(call.multipart).toBe(false); expect(call.form.get('api_key')).toBe(config.apiKey);
  });
  it('strips sensitive profile fields and returns bounded authenticated ICS', async () => {
    const h = harness(); const r = await h.call('wallos_get_profile'); expect(r.data.profile).toMatchObject({ budget: 200, totp_enabled: true }); expect(JSON.stringify(r)).not.toContain('SECRET');
    const calendar = await h.call('wallos_export_calendar'); expect(calendar.data.mime_type).toBe('text/calendar'); expect(calendar.data.content).toContain('BEGIN:VCALENDAR');
    h.fixture.malformedCalendar = true; expect((await h.call('wallos_export_calendar')).error.code).toBe('UPSTREAM_SCHEMA_ERROR');
  });
});
describe('stateless confirmations and deletion', () => {
  it('binds account, operation, intent and expiry without retaining state', async () => {
    const c = new Confirmation(configured, () => 1000000); const t = await c.issue('delete', { id: '1', version: 'x' });
    await expect(new Confirmation(configured, () => 1000100).verify(t.confirmation_token, 'delete', { id: '1', version: 'x' })).resolves.toBeUndefined();
    for (const [op,intent] of [['other', { id: '1', version: 'x' }], ['delete', { id: '2', version: 'x' }]] as const) await expect(c.verify(t.confirmation_token, op, intent)).rejects.toThrow();
    await expect(c.verify(`${t.confirmation_token}x`, 'delete', { id: '1', version: 'x' })).rejects.toThrow();
    await expect(new Confirmation({ ...configured, apiKey: 'different' }, () => 1000100).verify(t.confirmation_token, 'delete', { id: '1', version: 'x' })).rejects.toThrow();
    await expect(new Confirmation(configured, () => 1300000).verify(t.confirmation_token, 'delete', { id: '1', version: 'x' })).rejects.toThrow();
  });
  it('previews and deletes a reference across fresh account instances', async () => {
    const h = harness(); const context = await h.call('wallos_get_context'); const ref = context.data.currencies[1];
    const input = { kind: 'currency', id: ref.id, request_id, expected_version: ref.version };
    const p = await h.call('wallos_delete_reference', input); expect(p.data.dry_run).toBe(true); expect(h.fixture.writes).toBe(0);
    const account = new WallosAccount(configured, h.api);
    const r: any = await account.invoke('wallos_delete_reference', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.data.verified).toBe(true);
    expect(h.fixture.references.currency).toHaveLength(1);
  });
  it('blocks in-use/default reference and changed subscription/affected links', async () => {
    const h = harness(); const c = (await h.call('wallos_get_context')).data;
    expect((await h.call('wallos_delete_reference', { kind: 'currency', id: '1', request_id, expected_version: c.currencies[0].version })).error.code).toBe('REFERENCE_IN_USE');
    const input = { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]) };
    const p = await h.call('wallos_delete_subscription', input); h.fixture.base.rows.push(raw({ id: '43', replacement_subscription_id: '42' }));
    const r = await h.call('wallos_delete_subscription', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.error.code).toBe('INVALID_CONFIRMATION'); expect(h.fixture.writes).toBe(0);
  });
  it('deletes a subscription and verifies cascading replacement cleanup', async () => {
    const h = harness(); h.fixture.base.rows.push(raw({ id: '43', replacement_subscription_id: '42', inactive: true }));
    const input = { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]) };
    const p = await h.call('wallos_delete_subscription', input); expect(p.data.affected_subscription_ids).toEqual(['43']);
    const r = await h.call('wallos_delete_subscription', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.data.verified).toBe(true); expect(h.fixture.base.rows[0].replacement_subscription_id).toBeNull();
  });
  it('does not retry unknown deletion responses', async () => {
    const h = harness(); const input = { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]) };
    const p = await h.call('wallos_delete_subscription', input); h.fixture.loseWriteResponse = true;
    const r = await h.call('wallos_delete_subscription', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.error).toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN', retryable: false }); expect(h.fixture.writes).toBe(1);
  });
});
describe('replacement and media', () => {
  it('links an existing active replacement and clears the relationship independently', async () => {
    const h = harness(); h.fixture.base.rows.push(raw({ id: '43', name: 'New' }));
    const input = { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]), replacement_subscription_id: '43', replacement_expected_version: await digest(h.fixture.base.rows[1]) };
    const r = await h.call('wallos_set_subscription_replacement', input); expect(r.ok).toBe(true); expect(h.fixture.base.rows[0]).toMatchObject({ inactive: true, replacement_subscription_id: '43' });
    const cleared = await h.call('wallos_set_subscription_replacement', { subscription_id: '42', request_id, expected_version: r.data.version, replacement_subscription_id: null }); expect(cleared.ok).toBe(true); expect(h.fixture.base.rows[0].inactive).toBe(true);
  });
  it('rejects self replacement, inactive targets and cycles before dispatch', async () => {
    const h = harness(); const version = await digest(h.fixture.base.rows[0]);
    expect((await h.call('wallos_set_subscription_replacement', { subscription_id: '42', request_id, expected_version: version, replacement_subscription_id: '42', replacement_expected_version: version })).error.code).toBe('INVALID_REPLACEMENT');
    h.fixture.base.rows.push(raw({ id: '43', inactive: true }));
    expect((await h.call('wallos_set_subscription_replacement', { subscription_id: '42', request_id, expected_version: version, replacement_subscription_id: '43', replacement_expected_version: await digest(h.fixture.base.rows[1]) })).error.code).toBe('INVALID_REPLACEMENT');
    h.fixture.base.rows[1] = raw({ id: '43', replacement_subscription_id: '42' });
    expect((await h.call('wallos_set_subscription_replacement', { subscription_id: '42', request_id, expected_version: version, replacement_subscription_id: '43', replacement_expected_version: await digest(h.fixture.base.rows[1]) })).error.code).toBe('INVALID_REPLACEMENT');
  });
  it('uploads multipart image bytes and reports reference-only verification', async () => {
    const h = harness(); const media = { source: 'upload', mime: 'image/png', base64: Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64') };
    const logo = await h.call('wallos_set_subscription_logo', { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]), media }); expect(logo.data).toMatchObject({ verified: false, verification: 'stored_reference_only' }); expect(logo.meta.coverage).toBe('partial');
    const ref = (await h.call('wallos_get_context')).data.payment_methods[0];
    const icon = await h.call('wallos_set_payment_method_icon', { id: ref.id, request_id, expected_version: ref.version, media }); expect(icon.ok).toBe(true);
    expect(h.fixture.calls.filter(c => c.upload).every(c => c.multipart && c.upload?.type === 'image/png')).toBe(true);
  });
  it('rejects oversize, mislabelled and private image inputs', async () => {
    const h = harness(); const base = { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]) };
    const bad = await h.call('wallos_set_subscription_logo', { ...base, media: { source: 'upload', mime: 'image/png', base64: Buffer.from('not PNG').toString('base64') } }); expect(bad.error.code).toBe('INVALID_IMAGE');
    for (const url of ['https://127.0.0.1/a.png','https://[::1]/a.png','https://169.254.169.254/a','https://localhost/a']) expect((await h.call('wallos_set_subscription_logo', { ...base, media: { source: 'url', url } })).error.code).toBe('INVALID_IMAGE_URL');
    expect(contracts.wallos_set_subscription_logo.input.safeParse({ ...base, media: { source: 'upload', mime: 'image/png', base64: Buffer.alloc(32770).toString('base64') } }).success).toBe(false);
    for (const ip of ['10.0.0.1','172.16.0.1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::']) expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true); expect(isPublicAddress('2606:4700:4700::1111')).toBe(true); expect(h.fixture.writes).toBe(0);
  });
});
describe('preferences and opt-in configuration', () => {
  it('defaults configuration group off, including direct invocation', async () => {
    const h = harness(false); expect((await h.call('wallos_get_admin_settings')).error.code).toBe('INVALID_TOOL'); expect(h.fixture.calls).toHaveLength(0);
  });
  it('maps nested preferences to a partial form patch and checks merged colors before write', async () => {
    const h = harness(); const before = await h.call('wallos_get_preferences');
    const invalid = await h.call('wallos_update_preferences', { request_id, expected_version: before.data.version, changes: { css: 'x', main_color: '#00ffff' } }); expect(invalid.error.code).toBe('INVALID_COLORS'); expect(h.fixture.writes).toBe(0);
    const changed = await h.call('wallos_update_preferences', { request_id, expected_version: before.data.version, changes: { css: '', monthly_price: false, main_color: '#123456' } }); expect(changed.data.verified).toBe(true); expect(changed.data.state.accent_color).toBe('#00ffff');
    const form = h.fixture.calls.find(c => c.path === paths.setPreferences)!.form; expect([...form.keys()].sort()).toEqual(['api_key','css','main_color','monthly_price']);
  });
  it.each(['admin','oidc','fixer'] as const)('strips %s secrets and confirms writes with configured secret references', async kind => {
    const h = harness(); const readName = `wallos_get_${kind}_settings` as keyof typeof contracts; const writeName = `wallos_update_${kind}_settings` as keyof typeof contracts;
    const before = await h.call(readName); expect(JSON.stringify(before)).not.toContain('SECRET'); expect(JSON.stringify(before)).not.toContain('********');
    const changes = kind === 'admin' ? { max_users: 20, smtp_password: 'use_configured' } : { scopes: 'openid profile', client_secret: 'use_configured' };
    const input = kind === 'fixer' ? { request_id, expected_version: before.data.version, provider: 1, api_key_action: 'use_configured' } : { request_id, expected_version: before.data.version, changes };
    const p = await h.call(writeName, input); expect(p.ok).toBe(true); expect(h.fixture.writes).toBe(0); expect(JSON.stringify(p)).not.toContain('SECRET');
    const r = await h.call(writeName, { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.ok).toBe(true); expect(r.data).toMatchObject({ verified: false, verification: 'read_back_except_secrets' }); expect(JSON.stringify(r)).not.toContain('SECRET');
    const wire = h.fixture.calls.find(c => [paths.setAdmin,paths.setOidc,paths.setFixer].includes(c.path as never))!; expect(wire.form.get(kind === 'admin' ? 'smtp_password' : kind === 'oidc' ? 'client_secret' : 'fixer_api_key')).toContain('SECRET');
  });
  it('blocks managed OIDC fields before even toggling enablement', async () => {
    const h = harness(); h.fixture.managed = { client_secret: 'OIDC_CLIENT_SECRET' }; const before = await h.call('wallos_get_oidc_settings');
    const r = await h.call('wallos_update_oidc_settings', { request_id, expected_version: before.data.version, changes: { oidc_enabled: false, client_secret: 'clear' } }); expect(r.error.code).toBe('ENV_MANAGED_FIELD'); expect(h.fixture.writes).toBe(0);
  });
  it('requires confirmation for password-login toggles and verifies a separate endpoint', async () => {
    const h = harness(); const before = await h.call('wallos_get_oidc_settings'); const input = { request_id, expected_version: before.data.version, disabled: true };
    expect((await h.call('wallos_set_password_login', { ...input, dry_run: false })).error.code).toBe('CONFIRMATION_REQUIRED');
    const p = await h.call('wallos_set_password_login', input); const r = await h.call('wallos_set_password_login', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.data.state.password_login_disabled).toBe(true); expect(h.fixture.calls.some(c => c.path === paths.passwordLogin)).toBe(true);
  });
  it('clear Fixer explicitly removes configuration, never via omitted secret', async () => {
    const h = harness(); const before = await h.call('wallos_get_fixer_settings'); const input = { request_id, expected_version: before.data.version, provider: 0, api_key_action: 'clear' };
    const p = await h.call('wallos_update_fixer_settings', input); const r = await h.call('wallos_update_fixer_settings', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token }); expect(r.data.state).toMatchObject({ provider: null, api_key_configured: false });
    expect((await h.call('wallos_update_fixer_settings', { request_id, expected_version: r.data.version, provider: 1 })).error.code).toBe('INVALID_INPUT');
  });
  it('does not echo partial-write upstream errors or retry after failed readback', async () => {
    for (const mode of ['rejectAfterPartialWrite','failReadAfterWrite','loseWriteResponse'] as const) {
      const h = harness(); const before = await h.call('wallos_get_preferences'); h.fixture[mode] = true;
      const r = await h.call('wallos_update_preferences', { request_id, expected_version: before.data.version, changes: { monthly_price: false } }); expect(r.error).toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN', retryable: false }); expect(JSON.stringify(r)).not.toContain('SECRET'); expect(h.fixture.writes).toBe(1);
    }
  });
  it('validates configuration signing-key length and opt-in switch', () => {
    const base = { WALLOS_BASE_URL: config.baseUrl, WALLOS_API_KEY: config.apiKey, MCP_AUTH_TOKEN: 'x'.repeat(32) };
    expect(() => readConfig({ ...base, MCP_CONFIRMATION_KEY: 'short' })).toThrow(); expect(() => readConfig({ ...base, ENABLE_CONFIGURATION_TOOLS: 'true' })).toThrow(); expect(() => readConfig({ ...base, ENABLE_CONFIGURATION_TOOLS: 'yes' })).toThrow();
    expect(readConfig({ ...base, MCP_CONFIRMATION_KEY: configured.confirmationKey, ENABLE_CONFIGURATION_TOOLS: 'true' }).configurationTools).toBe(true);
  });
});


it('detects observable secret-only OIDC changes without exposing a guessable secret hash', async () => {
  const h = harness(); const before = await h.call('wallos_get_oidc_settings');
  h.fixture.oidc.client_secret = 'DIFFERENT-SECRET';
  const after = await h.call('wallos_get_oidc_settings');
  expect(after.data.version).not.toBe(before.data.version); expect(JSON.stringify(after)).not.toContain('DIFFERENT-SECRET');
  const r = await h.call('wallos_update_oidc_settings', { request_id, expected_version: before.data.version, changes: { scopes: 'openid' } });
  expect(r.error.code).toBe('VERSION_CONFLICT'); expect(h.fixture.writes).toBe(0);
});

it('binds configured-secret revisions without revealing raw secrets in preview tokens', async () => {
  const h = harness(); const before = await h.call('wallos_get_fixer_settings');
  const input = { request_id, expected_version: before.data.version, provider: 0, api_key_action: 'use_configured' };
  const p = await h.call('wallos_update_fixer_settings', input);
  const payload = Buffer.from(p.data.confirmation_token.split('.')[0], 'base64url').toString('utf8');
  expect(payload).not.toContain('SECRET'); expect(payload).not.toContain(config.apiKey);
  const cfg = { ...configured, secrets: { ...configured.secrets, fixer: 'ROTATED-SECRET' } };
  const account = new WallosAccount(cfg, new WallosClient(cfg, h.fixture.fetch));
  const result: any = await account.invoke('wallos_update_fixer_settings', { ...input, dry_run: false, confirmation_token: p.data.confirmation_token });
  expect(result.error.code).toBe('INVALID_CONFIRMATION'); expect(h.fixture.writes).toBe(0);
});


it('preserves omitted household email when only changing its name', async () => {
  const h = harness(); const before = (await h.call('wallos_get_context')).data.payer_members[0];
  const r = await h.call('wallos_update_reference', { kind: 'household_member', id: before.id, request_id, expected_version: before.version, changes: { name: 'Renamed' } });
  expect(r.ok).toBe(true); expect(r.data.reference.email).toBe('private@example.test');
  expect(h.fixture.calls.find(c => c.path === paths.setHousehold)!.form.get('email')).toBe('private@example.test');
});

it('blocks disabling an in-use payment method before sending', async () => {
  const h = harness(); const ref = (await h.call('wallos_get_context')).data.payment_methods[0];
  const r = await h.call('wallos_update_reference', { kind: 'payment_method', id: ref.id, request_id, expected_version: ref.version, changes: { enabled: false } });
  expect(r.error.code).toBe('REFERENCE_IN_USE'); expect(h.fixture.writes).toBe(0);
});

it('returns schema-valid ambiguity candidates after context metadata expansion', async () => {
  const h = harness(); h.fixture.references.category.push({ id: '2', name: '云存储', in_use: false, order: 2 });
  const r = await h.call('wallos_update_subscription', { subscription_id: '42', request_id, expected_version: await digest(h.fixture.base.rows[0]), changes: { category: { name: '云存储' } } });
  expect(r.error.code).toBe('AMBIGUOUS_REFERENCE'); expect(r.error.candidates).toEqual([{ id: '1', name: '云存储' }, { id: '2', name: '云存储' }]);
});
