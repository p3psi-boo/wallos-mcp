import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { WallosClient, paths } from '../wallos/client.js';
import { adminFields, oidcFields, preferenceFields, scalar, type stateSchema } from '../tools/extended-contracts.js';
import { fail, success } from './errors.js';
import { canonical, digest } from './identity.js';
import { Confirmation } from './confirmation.js';
import { formFields, verifiedWrite } from './verified-write.js';

type State = z.infer<typeof stateSchema>;
export type SettingsKind = 'preferences' | 'fixer' | 'admin' | 'oidc';
const getPaths = { preferences: paths.preferences, fixer: paths.fixer, admin: paths.admin, oidc: paths.oidc } as const;
const setPaths = { preferences: paths.setPreferences, fixer: paths.setFixer, admin: paths.setAdmin, oidc: paths.setOidc } as const;
const roots = { preferences: 'settings', fixer: 'fixer', admin: 'admin_settings', oidc: 'oidc_settings' } as const;
const secretFields = { smtp_password: 'smtp', client_secret: 'oidc', fixer_api_key: 'fixer' } as const;
const booleanKeys = new Set(['monthly_price','convert_currency','remove_background','hide_disabled','disabled_to_bottom','show_original_price','mobile_nav','show_subscription_progress','week_starts_sunday','registrations_open','require_email_verification','login_disabled','update_notification','oidc_oauth_enabled','oidc_enabled','auto_create_user','password_login_disabled','require_email_verified','totp_enabled']);
const numericKeys = new Set(['dark_theme','max_users','smtp_port','provider']);
function normalize(key: string, value: unknown): z.infer<typeof scalar> {
  if (booleanKeys.has(key)) {
    if (![0,1,'0','1',true,false].includes(value as never)) fail('UPSTREAM_SCHEMA_ERROR', '设置布尔字段格式错误。');
    return value === 1 || value === '1' || value === true;
  }
  if (numericKeys.has(key) && value !== null) {
    if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('UPSTREAM_SCHEMA_ERROR', '设置数值字段格式错误。');
    return Number(value);
  }
  const parsed = scalar.safeParse(value);
  if (!parsed.success) fail('UPSTREAM_SCHEMA_ERROR', '设置字段格式错误。');
  return parsed.data;
}
function pick(raw: Record<string, unknown>, keys: string[]): State {
  return Object.fromEntries(keys.filter(k => raw[k] !== undefined).map(k => [k, normalize(k, raw[k])]));
}
function managedFields(value: unknown) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value as string[];
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.keys(value);
  fail('UPSTREAM_SCHEMA_ERROR', '环境托管字段格式错误。');
}
export class SettingsService {
  constructor(private api: WallosClient, private config: Config) {}
  async profile() {
    const reply = await this.api.request(paths.profile, z.object({ user: z.object({ id: z.union([z.number(), z.string()]), username: z.string() }).catchall(z.unknown()) }));
    const profile = pick(reply.user, ['id','username','email','main_currency','language','budget','totp_enabled','firstname','lastname']);
    return success({ profile });
  }
  async read(kind: SettingsKind) {
    const root = roots[kind];
    const reply = await this.api.request(getPaths[kind], z.object({ [root]: z.union([z.record(z.string(), z.unknown()), z.array(z.never()).length(0), z.literal(false), z.null()]), oidc_enabled: z.unknown().optional(), managed_fields: z.unknown().optional() }));
    const source = reply[root]; const raw: Record<string, unknown> = source && !Array.isArray(source) ? source as Record<string, unknown> : {};
    let settings: State; let managed = managedFields(reply.managed_fields);
    if (kind === 'preferences') {
      settings = pick(raw, Object.keys(preferenceFields).filter(k => !['main_color','accent_color','hover_color','css'].includes(k)));
      if (raw.custom_colors && typeof raw.custom_colors === 'object') Object.assign(settings, pick(raw.custom_colors as Record<string, unknown>, ['main_color','accent_color','hover_color']));
      settings.css = raw.custom_css && typeof raw.custom_css === 'object' ? normalize('css', (raw.custom_css as Record<string, unknown>).css ?? '') : '';
    } else if (kind === 'fixer') settings = { provider: raw.provider === undefined ? null : normalize('provider', raw.provider), provider_name: typeof raw.provider_name === 'string' ? raw.provider_name : null, api_key_configured: Boolean(raw.api_key) };
    else if (kind === 'admin') {
      settings = pick(raw, [...Object.keys(adminFields).filter(k => k !== 'smtp_password'), 'latest_version']);
      // Getter always masks SMTP password, even when empty: presence is unknown.
      settings.smtp_password_configured = null;
      const oidc = await this.read('oidc');
      if (oidc.managed_fields.includes('oidc_enabled')) managed.push('oidc_oauth_enabled');
    } else {
      settings = pick(raw, Object.keys(oidcFields).filter(k => !['client_secret','oidc_enabled'].includes(k)));
      if (reply.oidc_enabled !== undefined) settings.oidc_enabled = normalize('oidc_enabled', reply.oidc_enabled);
      settings.client_secret_configured = Boolean(raw.client_secret);
      managed = managed.map(k => k === 'enabled' ? 'oidc_enabled' : k);
    }
    const secretField = { preferences: '', fixer: 'api_key', admin: 'smtp_password', oidc: 'client_secret' }[kind];
    // An opaque fingerprint detects changes when a getter exposes a secret, without an offline-guessable digest.
    // Fixed masks remain observationally indistinguishable; never claim otherwise.
    const secretRevision = secretField ? createHmac('sha256', this.config.apiKey).update(canonical(raw[secretField] ?? null)).digest('hex') : null;
    return { version: await digest({ settings, managed_fields: managed, secret_revision: secretRevision }), settings, managed_fields: managed };
  }
  private async current(kind: SettingsKind, expected: string) {
    const state = await this.read(kind);
    if (state.version !== expected) fail('VERSION_CONFLICT', '设置版本已变化，请重新读取。');
    return state;
  }
  private prepare(changes: Record<string, unknown>) {
    const wire = { ...changes }; const opaque: string[] = [];
    for (const [field, secret] of Object.entries(secretFields)) if (field in wire) {
      const action = wire[field]; opaque.push(field);
      if (action === 'clear') wire[field] = '';
      else {
        const configured = this.config.secrets?.[secret];
        if (!configured) fail('SECRET_NOT_CONFIGURED', '需要的密钥尚未在服务端环境变量中配置。');
        wire[field] = configured;
      }
    }
    return { wire, opaque };
  }
  async update(kind: SettingsKind, operation: string, input: { request_id: string; expected_version: string; changes: Record<string, unknown>; dry_run?: boolean; confirmation_token?: string }) {
    const before = await this.current(kind, input.expected_version);
    for (const key of Object.keys(input.changes)) if (before.managed_fields.includes(key)) fail('ENV_MANAGED_FIELD', '修改包含由 Wallos 环境变量托管的字段。');
    const combined = { ...before.settings, ...input.changes };
    if (kind === 'preferences' && combined.main_color && combined.main_color === combined.accent_color) fail('INVALID_COLORS', '主色与强调色应不同。');
    if (kind === 'admin' && combined.login_disabled && combined.registrations_open) fail('INVALID_SETTINGS', '关闭普通登录时应同时关闭注册。');
    if (kind === 'admin' && combined.require_email_verification && !combined.server_url) fail('INVALID_SETTINGS', '邮箱验证需要 server_url。');
    const { wire, opaque } = this.prepare(input.changes);
    // Hash the configured secret into intent without placing it in the token or output.
    const intent = { kind, version: before.version, changes: input.changes, configured_secret_digest: opaque.length ? createHmac('sha256', this.config.confirmationKey ?? this.config.apiKey).update(canonical(Object.fromEntries(opaque.map(k => [k, wire[k]])))).digest('hex') : null };
    const base = { request_id: input.request_id, operation, target_id: kind };
    if (kind !== 'preferences') {
      const confirmation = new Confirmation(this.config);
      if (input.dry_run !== false) return success({ ...base, dry_run: true, verified: false, verification: 'preview', state: pick(input.changes, Object.keys(input.changes)), ...await confirmation.issue(operation, intent) });
      await confirmation.verify(input.confirmation_token, operation, intent);
    }
    const fresh = await this.current(kind, input.expected_version);
    if (canonical(fresh.managed_fields) !== canonical(before.managed_fields)) fail('VERSION_CONFLICT', '环境托管配置已变化。');
    const endpoint = operation === 'wallos_set_password_login' ? paths.passwordLogin : setPaths[kind];
    const form = operation === 'wallos_set_password_login' ? { disable: input.changes.password_login_disabled ? '1' : '0' } : formFields(wire);
    return verifiedWrite(input.request_id, () => this.api.wire(endpoint, z.object({}), 'writeForm', form), async () => {
      const after = await this.read(kind);
      for (const [key, value] of Object.entries(input.changes)) {
        if (opaque.includes(key)) continue;
        if (kind === 'fixer' && key === 'provider' && input.changes.fixer_api_key === 'clear') continue;
        if (after.settings[key] !== value) fail('VERIFICATION_FAILED', '设置读回值与请求不符。');
      }
      if (kind === 'fixer' && after.settings.api_key_configured !== (input.changes.fixer_api_key !== 'clear')) fail('VERIFICATION_FAILED', '汇率配置读回状态不符。');
      return success({ ...base, dry_run: false, version: after.version, state: after.settings, verified: opaque.length === 0, verification: opaque.length ? 'read_back_except_secrets' : 'read_back' }, opaque.length ? ['非敏感字段已读回；上游可能掩码密钥，未验证密钥内容或 SMTP/OIDC 可用性。'] : [], opaque.length ? 'partial' : 'complete');
    });
  }
}
