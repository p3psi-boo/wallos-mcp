import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { canonical, digest } from './identity.js';
import { fail } from './errors.js';

/** No ledger/nonces: signatures prove intent, not single-use or exactly-once delivery. */
export class Confirmation {
  constructor(private config: Config, private now = () => Date.now()) {}
  private key() {
    if (!this.config.confirmationKey) fail('CONFIRMATION_NOT_CONFIGURED', '请配置 MCP_CONFIRMATION_KEY 后使用预览与确认。');
    return this.config.confirmationKey;
  }
  private async binding(operation: string, intent: unknown) {
    return { account: createHmac('sha256', this.key()).update(canonical({ url: this.config.baseUrl, key: this.config.apiKey })).digest('hex'), operation, intent: await digest(intent) };
  }
  async issue(operation: string, intent: unknown) {
    const expires = Math.floor(this.now() / 1000) + 300;
    const payload = Buffer.from(canonical({ v: 1, ...await this.binding(operation, intent), expires })).toString('base64url');
    const signature = createHmac('sha256', this.key()).update(payload).digest('base64url');
    return { confirmation_token: `${payload}.${signature}`, expires_at: new Date(expires * 1000).toISOString() };
  }
  async verify(token: string | undefined, operation: string, intent: unknown) {
    if (!token) fail('CONFIRMATION_REQUIRED', '先以 dry_run=true 预览，再携带 confirmation_token 执行。');
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) fail('INVALID_CONFIRMATION', '确认令牌格式错误。');
    const expected = createHmac('sha256', this.key()).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('INVALID_CONFIRMATION', '确认令牌签名不匹配。');
    let value: Record<string, unknown>;
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return fail('INVALID_CONFIRMATION', '确认令牌内容错误。'); }
    const binding = await this.binding(operation, intent);
    if (value.v !== 1 || value.account !== binding.account || value.operation !== binding.operation || value.intent !== binding.intent)
      fail('INVALID_CONFIRMATION', '确认令牌与账户、操作或目标版本不匹配。');
    if (typeof value.expires !== 'number' || value.expires <= Math.floor(this.now() / 1000)) fail('CONFIRMATION_EXPIRED', '确认令牌已过期，请重新预览。');
  }
}
