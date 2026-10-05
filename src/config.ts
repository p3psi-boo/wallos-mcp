import { fail } from './domain/errors';
import type { WallosAccount } from './account';

export interface Env {
  WALLOS_ACCOUNT: DurableObjectNamespace<WallosAccount>;
  WALLOS_BASE_URL: string;
  WALLOS_API_KEY: string;
  MCP_AUTH_TOKEN: string;
  TIMEZONE?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  ALLOW_HTTP_UPSTREAM?: string;
  ALLOWED_ORIGINS?: string;
}
export interface Config { baseUrl: string; apiKey: string; timezone: string; timeoutMs: number }
export function readConfig(env: Env): Config {
  let url: URL;
  try { url = new URL(env.WALLOS_BASE_URL); } catch { return fail('CONFIG_ERROR', '请配置 WALLOS_BASE_URL。'); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && env.ALLOW_HTTP_UPSTREAM === 'true')))
    fail('CONFIG_ERROR', 'Wallos 地址应为 HTTPS 安装根路径；本地 HTTP 需设置 ALLOW_HTTP_UPSTREAM。');
  if (!env.WALLOS_API_KEY) fail('CONFIG_ERROR', '请配置 WALLOS_API_KEY。');
  const timezone = env.TIMEZONE ?? 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('CONFIG_ERROR', 'TIMEZONE 不是有效时区。'); }
  const timeoutMs = Number(env.UPSTREAM_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) fail('CONFIG_ERROR', 'UPSTREAM_TIMEOUT_MS 应在 100–60000 之间。');
  return { baseUrl: url.href.replace(/\/?$/, '/'), apiKey: env.WALLOS_API_KEY, timezone, timeoutMs };
}
