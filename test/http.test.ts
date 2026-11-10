import { describe, it, expect } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createHttpHandler } from '../src/http';
import type { Env } from '../src/config';
import { WallosAccount } from '../src/account';
import { WallosClient } from '../src/wallos/client';
import { Fixture, config } from './fixture';
function mcpUrl(base: string) {
  const url = new URL(base);
  url.searchParams.set('key', config.apiKey);
  return url;
}
function harness() {
  const fixture = new Fixture();
  const env: Env = { WALLOS_BASE_URL: config.baseUrl, TIMEZONE: config.timezone, ALLOWED_ORIGINS: 'https://client.test' };
  const handler = createHttpHandler(env, apiKey => {
    const cfg = { ...config, apiKey };
    return (name, input) => new WallosAccount(cfg, new WallosClient(cfg, fixture.fetch)).invoke(name, input);
  });
  return { fixture, env, request: handler.fetch, handler };
}
describe('HTTP MCP transport', () => {
  it('requires the Wallos account key before accessing upstream', async () => {
    const h = harness();
    for (const url of ['https://mcp.test/mcp', 'https://mcp.test/mcp?key=']) {
      const response = await h.request(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: '{}' }));
      expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'Missing key' });
    }
    expect(h.fixture.calls).toHaveLength(0);
  });
  it('validates exact browser Origins and emits narrow CORS', async () => {
    const h = harness();
    expect((await h.request(new Request('https://mcp.test/mcp', { headers: { Origin: 'https://evil.test' } }))).status).toBe(403);
    const r = await h.request(new Request('https://mcp.test/mcp', { method: 'OPTIONS', headers: { Origin: 'https://client.test' } }));
    expect(r.status).toBe(204); expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://client.test');
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });
  it('bounds the actual request body, including requests without content-length', async () => {
    const h = harness();
    const r = await h.request(new Request(mcpUrl('https://mcp.test/mcp'), { method: 'POST', body: ' '.repeat(65537) }));
    expect(r.status).toBe(413); expect(h.fixture.calls).toHaveLength(0);
  });
  it('health contains no configuration or credentials; only exact /mcp is routed', async () => {
    const h = harness(); const health = await h.request(new Request('https://mcp.test/health'));
    expect(await health.json()).toEqual({ status: 'ok', service: 'wallos-mcp', phase: 2 });
    expect((await h.request(new Request('https://mcp.test/mcp/'))).status).toBe(404);
  });
  it('SDK client lists schemas, calls tools, gets business isError and reads resources', async () => {
    const h = harness();
    const client = new Client({ name: 'test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(mcpUrl('https://mcp.test/mcp'), { fetch: async (url, init) => h.request(new Request(url, init as RequestInit)) }));
      const { tools } = await client.listTools(); expect(tools).toHaveLength(20);
      expect(tools.every(t => t.outputSchema && t.inputSchema)).toBe(true);
      const context = await client.callTool({ name: 'wallos_get_context', arguments: {} }); expect(context.isError).toBe(false);
      expect(context.structuredContent).toMatchObject({ ok: true, data: { default_currency: 'CNY' } });
      expect(context.content).toEqual([{ type: 'text', text: JSON.stringify(context.structuredContent) }]);
      const conflict = await client.callTool({ name: 'wallos_update_subscription', arguments: { subscription_id: '42', request_id: 'conflict-001', expected_version: 'a'.repeat(64), changes: { name: 'new' } } });
      expect(conflict.isError).toBe(true); expect(conflict.structuredContent).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
      expect((await client.listResources()).resources).toHaveLength(3);
      expect((await client.readResource({ uri: 'wallos://cost-policy' })).contents).toHaveLength(1);
    } finally { await client.close(); }
  });
  it('supports stateless 2025 Streamable HTTP wire requests', async () => {
    const h = harness();
    const r = await h.request(new Request(mcpUrl('https://mcp.test/mcp'), { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json,text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wallos_get_context', arguments: {} } }) }));
    expect(r.status).toBe(200);
    const body = await r.text(); expect(body).toContain('structuredContent'); expect(body).toContain('default_currency');
    expect(r.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    expect(h.fixture.calls[0]?.form.get('api_key')).toBe(config.apiKey);
  });
  it('forwards the query key as the Wallos account key', async () => {
    let seen: string | null = null;
    const handler = createHttpHandler({ WALLOS_BASE_URL: config.baseUrl, TIMEZONE: config.timezone }, apiKey => {
      const cfg = { ...config, apiKey };
      return (name, input) => new WallosAccount(cfg, new WallosClient(cfg, async (inputUrl, init) => {
        const target = new URL(String(inputUrl));
        expect(target.search).toBe('');
        seen = new URLSearchParams(String(init?.body)).get('api_key');
        return Response.json({ success: false, title: 'Invalid API key' });
      })).invoke(name, input);
    });
    const response = await handler.fetch(new Request('https://mcp.test/mcp?key=client-account-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json,text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wallos_get_context', arguments: {} } }),
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(seen).toBe('client-account-key');
    expect(body).not.toContain('client-account-key');
    await handler.close();
  });
});

it('exposes the opt-in group and authenticated raw calendar resource via the SDK', async () => {
  const { ExtendedFixture } = await import('./extended-fixture');
  const fixture = new ExtendedFixture();
  const cfg = { ...config, configurationTools: true, confirmationKey: 'fixture-confirmation-key-with-32-plus-characters' };
  const handler = createHttpHandler({ WALLOS_BASE_URL: cfg.baseUrl, ENABLE_CONFIGURATION_TOOLS: 'true' }, apiKey => {
    const accountConfig = { ...cfg, apiKey };
    const scoped = new WallosAccount(accountConfig, new WallosClient(accountConfig, fixture.fetch));
    return (name, input) => scoped.invoke(name, input);
  });
  const client = new Client({ name: 'profile-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(mcpUrl('https://mcp.test/mcp'), { fetch: async (url, init) => handler.fetch(new Request(url, init as RequestInit)) }));
    const tools = (await client.listTools()).tools; expect(tools).toHaveLength(27); expect(tools.some(t => t.name === 'wallos_get_admin_settings')).toBe(true);
    const admin = await client.callTool({ name: 'wallos_get_admin_settings', arguments: {} }); expect(admin.isError).toBe(false); expect(JSON.stringify(admin)).not.toContain('SECRET');
    const calendar = (await client.readResource({ uri: 'wallos://calendar' })).contents[0]; expect(calendar.mimeType).toBe('text/calendar'); expect(calendar).toMatchObject({ text: expect.stringContaining('BEGIN:VCALENDAR') });
    const malformed = await client.callTool({ name: 'wallos_create_reference', arguments: { kind: 'category', request_id: 'http-test-001', data: { name: 'New', code: 'USD' } } }); expect(malformed.isError).toBe(true);
  } finally { await client.close(); await handler.close(); }
});
