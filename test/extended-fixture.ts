import { paths } from '../src/wallos/client';
import { Fixture, config } from './fixture';
export class ExtendedFixture {
  base = new Fixture();
  references: Record<string, Record<string, unknown>[]> = {
    category: [{ id: '1', name: '云存储', order: 1, in_use: true }],
    currency: [{ id: '1', name: '人民币', code: 'CNY', symbol: '¥', rate: 1, in_use: true }, { id: '2', name: '美元', code: 'USD', symbol: '$', rate: 0.14, in_use: false }],
    household_member: [{ id: '1', name: '本人', email: 'private@example.test', in_use: true }],
    payment_method: [{ id: '1', name: '支付宝', enabled: true, icon: 'old.png', order: 1, in_use: true }],
  };
  preferences: Record<string, unknown> = { dark_theme: 0, monthly_price: 1, convert_currency: 0, color_theme: 'blue', custom_css: { css: '' }, custom_colors: { main_color: '#0000ff', accent_color: '#00ffff', hover_color: '#00008b' } };
  admin: Record<string, unknown> = { registrations_open: 0, max_users: 10, require_email_verification: 0, server_url: 'https://wallos.test/', smtp_address: '', smtp_port: 587, smtp_username: '', smtp_password: '********', from_email: '', encryption: 'tls', login_disabled: 0, update_notification: 1, oidc_oauth_enabled: 1, local_webhook_notifications_allowlist: '' };
  oidc: Record<string, unknown> = { name: 'Auth', client_id: 'client', client_secret: 'SECRET-OIDC', token_url: 'https://auth.test/token', auth_style: 'auto', auto_create_user: 0, password_login_disabled: 0, require_email_verified: 0 };
  fixer: Record<string, unknown> | [] = { api_key: '********', provider: 0, provider_name: 'Fixer.io' };
  managed: Record<string, string> = {};
  calls: { path: string; form: URLSearchParams; multipart: boolean; upload?: File }[] = [];
  loseWriteResponse = false; rejectAfterPartialWrite = false; failReadAfterWrite = false;
  writes = 0; malformedCalendar = false;
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.search || init?.method !== 'POST') throw new Error('URL credential leak');
    const multipart = init.body instanceof FormData;
    const form = multipart ? new URLSearchParams([...init.body as FormData].filter(([,v]) => typeof v === 'string') as [string,string][]) : new URLSearchParams(String(init.body));
    if (form.get('api_key') !== config.apiKey) throw new Error('Bad key');
    const path = url.pathname.replace('/subfolder/', '');
    const upload = multipart ? (init.body as FormData).get('logo') ?? (init.body as FormData).get('paymenticon') : undefined;
    this.calls.push({ path, form, multipart, upload: upload instanceof File ? upload : undefined });
    const reply = (value: object) => Response.json({ success: true, ...value });
    const acknowledge = () => { this.writes++; if (this.loseWriteResponse) throw new Error('Committed then disconnected'); if (this.rejectAfterPartialWrite) return Response.json({ success: false, title: 'Validation error', message: 'SECRET-OIDC' }); return reply({}); };
    const getReference = { [paths.categories]: ['category','categories'], [paths.currencies]: ['currency','currencies'], [paths.household]: ['household_member','household'], [paths.paymentMethods]: ['payment_method','payment_methods'] }[path];
    if (getReference) return reply({ [getReference[1]]: this.references[getReference[0]], ...(getReference[0] === 'currency' ? { main_currency: '1' } : {}) });
    const setReference = { [paths.setCategories]: ['category','categoryId'], [paths.setCurrencies]: ['currency','currencyId'], [paths.setHousehold]: ['household_member','memberId'], [paths.setPaymentMethods]: ['payment_method','paymentId'] }[path];
    if (setReference) {
      const [kind,idField] = setReference; const rows = this.references[kind];
      const id = form.get('id') ?? String(Math.max(0, ...rows.map(r => Number(r.id)))+1);
      if (form.get('action') === 'delete') this.references[kind] = rows.filter(r => r.id !== id);
      else {
        const row = rows.find(r => r.id === id) ?? { id, in_use: false, ...(kind === 'household_member' ? { email: '' } : kind === 'payment_method' ? { enabled: true, icon: '' } : kind === 'currency' ? { rate: 1 } : {}) };
        for (const [k,v] of form) if (!['api_key','action','id','icon_url'].includes(k)) row[k] = k === 'enabled' ? v === '1' : v;
        if (form.has('icon_url') || upload) row.icon = 'saved-icon.png';
        if (!rows.includes(row)) rows.push(row);
      }
      const response = acknowledge();
      return response.ok && !this.rejectAfterPartialWrite ? reply({ [idField]: id }) : response;
    }
    if (this.failReadAfterWrite && this.writes && [paths.preferences,paths.fixer,paths.admin,paths.oidc].includes(path as never)) throw new Error('Read failed');
    switch (path) {
      case paths.profile: return reply({ user: { id: 1, username: 'user', email: 'user@example.test', budget: 200, totp_enabled: 1, password: 'SECRET-PASSWORD', api_key: 'SECRET-KEY', avatar: 'https://example.test/?token=SECRET' } });
      case paths.calendar: return new Response(this.malformedCalendar ? '<html>error</html>' : 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', { headers: { 'Content-Type': 'text/calendar' } });
      case paths.preferences: return reply({ settings: this.preferences });
      case paths.admin: return reply({ admin_settings: this.admin });
      case paths.oidc: return reply({ oidc_settings: this.oidc, oidc_enabled: this.admin.oidc_oauth_enabled, managed_fields: this.managed, notes: ['SECRET-NOTE'] });
      case paths.fixer: return reply({ fixer: this.fixer });
      case paths.setPreferences:
        for (const [k,v] of form) {
          if (k === 'api_key') continue;
          if (['main_color','accent_color','hover_color'].includes(k)) (this.preferences.custom_colors as Record<string,unknown>)[k] = v;
          else if (k === 'css') this.preferences.custom_css = { css: v };
          else this.preferences[k] = v;
        }
        return acknowledge();
      case paths.setAdmin: for (const [k,v] of form) if (k !== 'api_key') this.admin[k] = k === 'smtp_password' ? '********' : v; return acknowledge();
      case paths.setOidc:
        for (const [k,v] of form) if (k === 'oidc_enabled') this.admin.oidc_oauth_enabled = v; else if (k !== 'api_key') this.oidc[k] = v;
        return acknowledge();
      case paths.passwordLogin: this.oidc.password_login_disabled = form.get('disable'); return acknowledge();
      case paths.setFixer: this.fixer = form.get('fixer_api_key') ? { api_key: '********', provider: form.get('provider'), provider_name: 'Fixer.io' } : []; return acknowledge();
      case paths.write:
        if (form.get('action') === 'delete') {
          const id = form.get('id'); this.base.rows = this.base.rows.filter(r => r.id !== id).map(r => r.replacement_subscription_id === id ? { ...r, replacement_subscription_id: null } : r); return acknowledge();
        }
        if (upload || form.has('logo_url')) {
          this.base.rows = this.base.rows.map(r => r.id === form.get('id') ? { ...r, logo: 'saved-logo.png' } : r); return acknowledge();
        }
        break;
    }
    return this.base.fetch(input, { ...init, body: form.toString() });
  };
}
