import { z } from 'zod';
import type { paths as ApiPaths } from './generated.js';
type WithoutLeadingSlash<T> = T extends `/${infer P}` ? P : never;
import type { Config } from '../config.js';
import { fail } from '../domain/errors.js';
import { WallosTransport, type Upload, type WireMode } from './transport.js';
import { currencyRow, rawSubscriptionSchema, referenceRow } from './schema.js';

export const paths = {
  currencies: 'api/currencies/get_currencies.php', categories: 'api/categories/get_categories.php',
  household: 'api/household/get_household.php', paymentMethods: 'api/payment_methods/get_payment_methods.php',
  notifications: 'api/notifications/get_notification_settings.php',
  subscriptions: 'api/subscriptions/get_subscriptions.php', subscription: 'api/subscriptions/get_subscription.php',
  monthly: 'api/subscriptions/get_monthly_cost.php', write: 'api/subscriptions/set_subscriptions.php',
  setCategories: 'api/categories/set_categories.php', setCurrencies: 'api/currencies/set_currencies.php',
  setHousehold: 'api/household/set_household.php', setPaymentMethods: 'api/payment_methods/set_payment_methods.php',
  profile: 'api/users/get_user.php', calendar: 'api/subscriptions/get_ical_feed.php',
  preferences: 'api/settings/get_settings.php', setPreferences: 'api/settings/set_settings.php',
  fixer: 'api/fixer/get_fixer.php', setFixer: 'api/fixer/set_fixer.php',
  admin: 'api/admin/get_admin_settings.php', setAdmin: 'api/admin/set_admin_settings.php',
  oidc: 'api/admin/get_oidc_settings.php', setOidc: 'api/admin/set_oidc_settings.php',
  passwordLogin: 'api/admin/set_disable_password_login.php',
} as const satisfies Record<string, WithoutLeadingSlash<keyof ApiPaths>>;
export type Form = Record<string, string>;
export class WallosClient {
  private transport: WallosTransport;
  constructor(config: Config, fetcher: typeof fetch = (input, init) => fetch(input, init)) { this.transport = new WallosTransport(config, fetcher); }
  request<T extends z.ZodType>(path: typeof paths[keyof typeof paths], schema: T, form: Form = {}, write = false): Promise<z.infer<T>> {
    return this.transport.json(path, schema, write ? 'writeForm' : 'readJson', form);
  }
  wire<T extends z.ZodType>(path: typeof paths[keyof typeof paths], schema: T, mode: WireMode, form: Form = {}, upload?: Upload): Promise<z.infer<T>> {
    return this.transport.json(path, schema, mode, form, upload);
  }
  async calendar(): Promise<string> { return await this.transport.send(paths.calendar, 'readCalendar', { convert_currency: 'false' }) as string; }
  currencies() {
    return this.request(paths.currencies, z.object({ main_currency: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]).transform(String), currencies: z.array(currencyRow) }));
  }
  async categories() { return (await this.request(paths.categories, z.object({ categories: z.array(referenceRow) }))).categories; }
  async members() { return (await this.request(paths.household, z.object({ household: z.array(referenceRow) }))).household; }
  async paymentMethods() { return (await this.request(paths.paymentMethods, z.object({ payment_methods: z.array(referenceRow) }))).payment_methods; }
  async notifications() {
    const channel = z.object({ enabled: z.union([z.number().int().min(0).max(1), z.string().regex(/^[01]$/), z.boolean()]) }).transform(c => c.enabled === true || c.enabled === 1 || c.enabled === '1');
    const settings = z.object({ days: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]).optional(),
      ...Object.fromEntries(['email', 'discord', 'gotify', 'ntfy', 'pushover', 'telegram', 'webhook', 'serverchan'].map(name => [`${name}_notifications`, channel.nullable().optional()])),
    });
    const reply = await this.request(paths.notifications, z.object({ notification_settings: z.union([settings, z.array(z.never()).length(0)]).nullable() }));
    const s = reply.notification_settings;
    if (!s || Array.isArray(s)) return { default_days_before: null, enabled_channels: [], delivery_verified: false as const };
    return { default_days_before: s.days ?? null, enabled_channels: Object.entries(s).filter(([k, v]) => k.endsWith('_notifications') && (v as unknown) === true).map(([k]) => k.replace('_notifications', '')), delivery_verified: false as const };
  }
  async subscriptions() { return (await this.request(paths.subscriptions, z.object({ subscriptions: z.array(rawSubscriptionSchema) }), { convert_currency: 'false', sort: 'id' })).subscriptions; }
  async subscription(id: string) {
    const row = (await this.request(paths.subscription, z.object({ subscription: rawSubscriptionSchema }), { id, convert_currency: 'false' })).subscription;
    if (row.id !== id) fail('UPSTREAM_SCHEMA_ERROR', '返回的订阅 ID 与请求不一致。');
    return row;
  }
  monthly(month: string) {
    return this.request(paths.monthly, z.object({ monthly_cost: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:,\d{3})*(?:\.\d+)?$/)]).transform(v => String(v).replaceAll(',', '')), currency_code: z.string().regex(/^[A-Z]{3}$/), notes: z.array(z.string()).optional() }), { year: month.slice(0, 4), month: String(Number(month.slice(5))) });
  }
  write(action: 'add' | 'edit' | 'delete', form: Form) {
    return this.request(paths.write, z.object({ subscriptionId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]).transform(String).optional() }), { ...form, action }, true);
  }
}
