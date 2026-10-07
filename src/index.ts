import { WallosAccount } from './account.js';
import { readConfig, type Env } from './config.js';
import { createHttpHandler } from './http.js';
import { createNodeServer } from './node-http.js';

async function main() {
  const env: Env = {
    WALLOS_BASE_URL: process.env.WALLOS_BASE_URL ?? '',
    WALLOS_API_KEY: process.env.WALLOS_API_KEY ?? '',
    MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN ?? '',
    MCP_CONFIRMATION_KEY: process.env.MCP_CONFIRMATION_KEY,
    ENABLE_CONFIGURATION_TOOLS: process.env.ENABLE_CONFIGURATION_TOOLS,
    WALLOS_FIXER_API_KEY: process.env.WALLOS_FIXER_API_KEY,
    WALLOS_SMTP_PASSWORD: process.env.WALLOS_SMTP_PASSWORD,
    WALLOS_OIDC_CLIENT_SECRET: process.env.WALLOS_OIDC_CLIENT_SECRET,
    TIMEZONE: process.env.TIMEZONE,
    UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
    ALLOW_HTTP_UPSTREAM: process.env.ALLOW_HTTP_UPSTREAM,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  };
  const config = readConfig(env);
  if (env.MCP_AUTH_TOKEN.length < 32) throw new Error('MCP_AUTH_TOKEN must contain at least 32 characters');
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const account = new WallosAccount(config);
  const handler = createHttpHandler(env, (name, input) => account.invoke(name, input));
  const server = createNodeServer(handler);
  server.on('error', () => { console.error('HTTP server failed to listen'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Wallos MCP listening on ${host}:${port} (/mcp)`));

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 30000).unref();
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    await handler.close();
    await closed;
    clearTimeout(deadline);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void stop().catch(() => process.exit(1)); });
  }
}

void main().catch(() => { console.error('Invalid server configuration; check environment variables'); process.exitCode = 1; });
