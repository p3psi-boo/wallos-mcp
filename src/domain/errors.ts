import { z } from 'zod';

export const errorSchema = z.strictObject({
  code: z.string(), message: z.string(), retryable: z.boolean(),
  resolution: z.string().optional(),
  candidates: z.array(z.strictObject({ id: z.string(), name: z.string() })).optional(),
  request_id: z.string().optional(), subscription_id: z.string().optional(),
});
export type ErrorDetail = z.infer<typeof errorSchema>;
export class BusinessError extends Error {
  constructor(public readonly detail: ErrorDetail) { super(detail.message); }
}
export function fail(code: string, message: string, extra: Partial<ErrorDetail> = {}): never {
  throw new BusinessError({ code, message, retryable: false, ...extra });
}
export function errorResult(error: unknown) {
  const detail = error instanceof BusinessError ? error.detail : {
    code: 'INTERNAL_ERROR', message: '服务内部错误。', retryable: false,
    resolution: '检查服务端配置和运行状态。',
  };
  return { ok: false as const, error: detail };
}
export function resultSchema<T extends z.ZodType>(data: T) {
  // Object-shaped root for both SDK validation and older MCP clients.
  return z.strictObject({
    ok: z.boolean(), data: data.optional(), error: errorSchema.optional(),
    meta: z.strictObject({ retrieved_at: z.iso.datetime(), coverage: z.enum(['complete', 'partial', 'next_payment_only']) }).optional(),
    warnings: z.array(z.string()).optional(),
  }).superRefine((v, ctx) => {
    if (v.ok ? (!v.data || !v.meta || !v.warnings || v.error !== undefined) : (!v.error || v.data !== undefined || v.meta !== undefined || v.warnings !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Result envelope does not match ok.' });
  });
}
export function success<T>(data: T, warnings: string[] = [], coverage: 'complete' | 'partial' | 'next_payment_only' = 'complete') {
  return { ok: true as const, data, meta: { retrieved_at: new Date().toISOString(), coverage }, warnings };
}
