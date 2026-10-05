import { z } from 'zod';
import { dateSchema } from '../domain/schema.js';
const numericId = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d{0,14}$/)]).transform(String);
const integer = z.union([z.number().int(), z.string().regex(/^-?\d+$/).transform(Number)]);
const bit = z.union([z.literal(0), z.literal(1), z.literal('0'), z.literal('1'), z.boolean()]).transform(v => v === 1 || v === '1' || v === true);
const nullableDate = z.union([dateSchema, z.literal(''), z.null()]).transform(v => v || null);
export const referenceRow = z.object({ id: numericId, name: z.string(), enabled: bit.optional() });
export const currencyRow = referenceRow.extend({ code: z.string().regex(/^[A-Z]{3}$/) });
export const rawSubscriptionSchema = z.object({
  id: numericId, name: z.string(),
  price: z.union([z.number().nonnegative().finite(), z.string().regex(/^\d+(?:\.\d+)?$/)]).transform(String),
  currency_id: numericId, cycle: integer.pipe(z.number().int().min(1).max(4)), frequency: integer.pipe(z.number().int().min(1).max(10000)),
  next_payment: dateSchema, start_date: nullableDate,
  auto_renew: bit, inactive: bit, notify: bit,
  notify_days_before: integer.pipe(z.number().min(0).max(365)).nullable(),
  category_id: numericId.nullable(), payer_user_id: numericId.nullable(), payment_method_id: numericId.nullable(),
  notes: z.string().nullable().transform(v => v ?? ''), url: z.string().nullable().transform(v => v || null),
  cancellation_date: nullableDate,
  // Retained in the version digest to detect hidden changes; not exposed in tool output.
  replacement_subscription_id: numericId.nullable().optional(), logo: z.string().optional(),
});
export type RawSubscription = z.infer<typeof rawSubscriptionSchema>;
export const envelopeSchema = z.object({ success: z.boolean(), title: z.string().optional() }).passthrough();
