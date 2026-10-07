import { BusinessError, fail } from './errors.js';
import { digest } from './identity.js';

export async function checkVersion(value: unknown, expected: string) {
  if (await digest(value) !== expected) fail('VERSION_CONFLICT', '对象版本已变化，请重新读取后编排。');
}
export async function verifiedWrite<T>(requestId: string, dispatch: () => Promise<unknown>, verify: () => Promise<T>) {
  let acknowledged = false;
  try {
    await dispatch(); acknowledged = true;
    return await verify();
  } catch (error) {
    // Several PHP endpoints can partially write before returning success:false. Only auth/not-found are proven pre-write failures.
    if (!acknowledged && error instanceof BusinessError && ['UPSTREAM_AUTH_ERROR', 'NOT_FOUND'].includes(error.detail.code)) throw error;
    fail('WRITE_OUTCOME_UNKNOWN', '写入可能已生效或部分生效；请重新读取核对，不自动重发。', { request_id: requestId, retryable: false });
  }
}
export function formFields(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'boolean' ? v ? '1' : '0' : v === null ? '' : String(v)]));
}
