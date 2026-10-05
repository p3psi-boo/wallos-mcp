import { z } from 'zod';
import type { paths as ApiPaths } from './generated';
type WithoutLeadingSlash<T> = T extends `/${infer P}` ? P : never;
import type { Config } from '../config';
import { fail, BusinessError } from '../domain/errors';
import { currencyRow, envelopeSchema, rawSubscriptionSchema, referenceRow } from './schema';

export const paths = {
  currencies: 'api/currencies/get_currencies.php', categories: 'api/categories/get_categories.php',
  household: 'api/household/get_household.php', paymentMethods: 'api/payment_methods/get_payment_methods.php',
  notifications: 'api/notifications/get_notification_settings.php',
  subscriptions: 'api/subscriptions/get_subscriptions.php', subscription: 'api/subscriptions/get_subscription.php',
  monthly: 'api/subscriptions/get_monthly_cost.php', write: 'api/subscriptions/set_subscriptions.php',
} as const satisfies Record<string, WithoutLeadingSlash<keyof ApiPaths>>;
export type Form = Record<string, string>;
export class WallosClient {
  constructor(private config: Config, private fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  async request<T extends z.ZodType>(path: typeof paths[keyof typeof paths], schema: T, form: Form = {}, write = false): Promise<z.infer<T>> {
    // All endpoints used here accept POST; credentials never appear in the URL.
    const body = new URLSearchParams({ ...form, api_key: this.config.apiKey });
    let json: unknown;
    try {
      const response = await this.fetcher(new URL(path, this.config.baseUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(), redirect: 'manual', signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_HTTP_ERROR', 'Wallos HTTP 响应异常。', { retryable: !write });
      if (!response.body) throw new Error('Empty body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Oversized response'); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof BusinessError) throw error;
      fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_UNAVAILABLE', write ? '写入结果待核对；保持 request_id，不重复新增。' : '读取 Wallos 失败。', { retryable: !write });
    }
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_SCHEMA_ERROR', 'Wallos 响应与固定接口契约不符。');
    if (!envelope.data.success) {
      const title = envelope.data.title?.toLowerCase() ?? '';
      const code = title.includes('not found') ? 'NOT_FOUND' : title.includes('api key') || title.includes('unauthorized') ? 'UPSTREAM_AUTH_ERROR' : 'UPSTREAM_REJECTED';
      // Upstream error strings can contain credentials, SQL, or account configuration. Do not echo them.
      fail(code, code === 'NOT_FOUND' ? '订阅不存在或不属于当前账户。' : 'Wallos 拒绝此请求；请检查字段和服务端账户配置。');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) fail(write ? 'WRITE_OUTCOME_UNKNOWN' : 'UPSTREAM_SCHEMA_ERROR', 'Wallos 响应字段与固定契约不符。');
    return parsed.data;
  }
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
  write(action: 'add' | 'edit', form: Form) {
    return this.request(paths.write, z.object({ subscriptionId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]).transform(String).optional() }), { ...form, action }, true);
  }
}
