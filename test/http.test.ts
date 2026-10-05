import { describe, it, expect } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import http from '../src/http';
import type { Env } from '../src/config';
import { contracts, isToolName } from '../src/tools/contracts';
import { WallosClient } from '../src/wallos/client';
import { ReadService } from '../src/domain/reads';
import { MutationService } from '../src/domain/mutations';
import { OperationRunner } from '../src/operations/runner';
import { Fixture, MemoryStore, config } from './fixture';
const token = 'fixture-token-with-at-least-32-characters';
function harness() {
  const fixture = new Fixture(), store = new MemoryStore();
  const api = new WallosClient(config, fixture.fetch), reads = new ReadService(api, config), writes = new OperationRunner(store, new MutationService(api, config));
  const stub = { invoke: async (name: string, input: unknown) => {
    if (!isToolName(name)) throw new Error('Unknown tool');
    const data = contracts[name].input.parse(input);
    return contracts[name].readOnly ? reads.invoke(name, data) : writes.run(name, data as { request_id: string } & Record<string, unknown>);
  } };
  const env = { WALLOS_ACCOUNT: { idFromName: (name: string) => name, get: () => stub }, MCP_AUTH_TOKEN: token,
    WALLOS_BASE_URL: config.baseUrl, WALLOS_API_KEY: config.apiKey, TIMEZONE: config.timezone, ALLOWED_ORIGINS: 'https://client.test' } as unknown as Env;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
  const request = (input: Request) => http.fetch(input, env, ctx);
  return { fixture, env, request };
}
describe('HTTP MCP transport', () => {
  it('requires bearer authentication before accessing upstream', async () => {
    const h = harness();
    for (const auth of ['', 'Bearer wrong']) {
      const response = await h.request(new Request('https://mcp.test/mcp', { method: 'POST', headers: { Authorization: auth }, body: '{}' }));
      expect(response.status).toBe(401); expect(response.headers.get('WWW-Authenticate')).toContain('Bearer');
    }
    expect(h.fixture.calls).toHaveLength(0);
    h.env.MCP_AUTH_TOKEN = '';
    expect((await h.request(new Request('https://mcp.test/mcp'))).status).toBe(503);
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
    const r = await h.request(new Request('https://mcp.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: ' '.repeat(65537) }));
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
      await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), { fetch: async (url, init) => h.request(new Request(url, init as RequestInit)), requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      const { tools } = await client.listTools(); expect(tools).toHaveLength(9);
      expect(tools.every(t => t.outputSchema && t.inputSchema)).toBe(true);
      const context = await client.callTool({ name: 'wallos_get_context', arguments: {} }); expect(context.isError).toBe(false);
      expect(context.structuredContent).toMatchObject({ ok: true, data: { default_currency: 'CNY' } });
      expect(context.content).toEqual([{ type: 'text', text: JSON.stringify(context.structuredContent) }]);
      const conflict = await client.callTool({ name: 'wallos_update_subscription', arguments: { subscription_id: '42', request_id: 'conflict-001', expected_version: 'a'.repeat(64), changes: { name: 'new' } } });
      expect(conflict.isError).toBe(true); expect(conflict.structuredContent).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
      expect((await client.listResources()).resources).toHaveLength(2);
      expect((await client.readResource({ uri: 'wallos://cost-policy' })).contents).toHaveLength(1);
    } finally { await client.close(); }
  });
  it('supports stateless 2025 Streamable HTTP wire requests', async () => {
    const h = harness();
    const r = await h.request(new Request('https://mcp.test/mcp', { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json,text/event-stream', 'MCP-Protocol-Version': '2025-06-18',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wallos_get_context', arguments: {} } }) }));
    expect(r.status).toBe(200);
    const body = await r.text(); expect(body).toContain('structuredContent'); expect(body).toContain('default_currency');
    expect(r.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });
});
