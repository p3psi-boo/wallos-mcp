import { z } from 'zod';

export const idSchema = z.string().regex(/^[1-9]\d{0,14}$/);
export const dateSchema = z.string().regex(/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Expected a real calendar date (1900–2199).');
export const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/);
export const currencyCode = z.string().regex(/^[A-Z]{3}$/);
export const nameSchema = z.string().trim().min(1).max(200);
export const refSchema = z.strictObject({ id: idSchema.optional(), name: nameSchema.optional() })
  .refine(r => r.id !== undefined || r.name !== undefined, 'Provide id or name.');
export const namedSchema = z.strictObject({ id: idSchema, name: z.string() });
export const priceSchema = z.strictObject({ amount: amountSchema, currency: currencyCode });
export const billingSchema = z.strictObject({ interval: z.number().int().min(1).max(10000), unit: z.enum(['day', 'week', 'month', 'year']) });
export const reminderSchema = z.strictObject({ enabled: z.boolean(), days_before: z.number().int().min(0).max(365).nullable() });
const managedNamed = namedSchema.extend({ version: z.string().regex(/^[a-f0-9]{64}$/).optional(), in_use: z.boolean().nullable().optional(), enabled: z.boolean().optional(), order: z.number().int().optional() });
export const contextSchema = z.strictObject({
  timezone: z.string(), today: dateSchema, default_currency: currencyCode,
  currencies: z.array(managedNamed.extend({ code: currencyCode, symbol: z.string().optional(), rate: z.string().optional(), is_default: z.boolean().optional() })),
  categories: z.array(managedNamed), payer_members: z.array(managedNamed), payment_methods: z.array(managedNamed),
  reminder: z.strictObject({ default_days_before: z.number().int().min(0).nullable(), enabled_channels: z.array(z.string()), delivery_verified: z.literal(false) }),
});
export const summarySchema = z.strictObject({
  subscription_id: idSchema, name: z.string(), tracking_state: z.enum(['active', 'inactive']),
  price: priceSchema, billing: billingSchema, next_payment_date: dateSchema,
  category: namedSchema.nullable(), payer_member: namedSchema.nullable(), payment_method: namedSchema.nullable(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
});
export const subscriptionSchema = summarySchema.extend({
  start_date: dateSchema.nullable(), notes: z.string(), url: z.string().nullable(),
  renewal: z.enum(['automatic', 'manual']), cancellation_date: dateSchema.nullable(), reminder: reminderSchema, replacement_subscription_id: idSchema.nullable().optional(), logo: z.string().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Context = z.infer<typeof contextSchema>;
export type Ref = z.infer<typeof refSchema>;
export const patchSchema = z.strictObject({
  name: nameSchema.optional(), price: priceSchema.optional(), billing: billingSchema.optional(),
  start_date: dateSchema.optional(), next_payment_date: dateSchema.optional(),
  category: refSchema.nullable().optional(), payer_member: refSchema.nullable().optional(), payment_method: refSchema.nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  url: z.url().max(2000).refine(s => ['http:', 'https:'].includes(new URL(s).protocol)).nullable().optional(),
  renewal: z.enum(['automatic', 'manual']).optional(),
}).refine(p => Object.keys(p).length > 0, 'At least one change is required.');
export const createSchema = z.strictObject({
  name: nameSchema, price: priceSchema, billing: billingSchema,
  start_date: dateSchema, next_payment_date: dateSchema,
  category: refSchema.optional(), payer_member: refSchema.optional(), payment_method: refSchema.optional(),
  notes: z.string().max(10000).optional(), url: z.url().max(2000).refine(s => ['http:', 'https:'].includes(new URL(s).protocol)).optional(),
  renewal: z.enum(['automatic', 'manual']).default('automatic'),
}).refine(s => s.next_payment_date >= s.start_date, 'next_payment_date precedes start_date.');
export type Patch = z.infer<typeof patchSchema>;
