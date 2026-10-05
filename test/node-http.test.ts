import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { WallosAccount } from '../src/account';
import { createHttpHandler } from '../src/http';
import { createNodeServer } from '../src/node-http';
import { contracts } from '../src/tools/contracts';
import { WallosClient } from '../src/wallos/client';
import { Fixture, config } from './fixture';

const token = 'fixture-token-with-at-least-32-characters';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

async function listen(fixture = new Fixture()) {
  const account = new WallosAccount(config, new WallosClient(config, fixture.fetch));
  const app = createHttpHandler({ WALLOS_BASE_URL: config.baseUrl, WALLOS_API_KEY: config.apiKey, MCP_AUTH_TOKEN: token },
    (name, input) => account.invoke(name, input));
  const server = createNodeServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const close = async () => {
    await app.close();
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  };
  cleanup.push(close);
  return { fixture, close, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('self-hosted Node HTTP server', () => {
  it('serves health and authenticates before accessing Wallos', async () => {
    const h = await listen();
    expect(await (await fetch(`${h.url}/health`)).json()).toEqual({ status: 'ok', service: 'wallos-mcp', phase: 2 });
    expect((await fetch(`${h.url}/mcp`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect(h.fixture.calls).toHaveLength(0);
  });

  it('bounds chunked bodies before the Node adapter buffers them', async () => {
    const h = await listen();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${h.url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(' '.repeat(40000));
      req.end(' '.repeat(40000));
    });
    expect(status).toBe(413); expect(h.fixture.calls).toHaveLength(0);
  });

  it('serves SDK tools and executes repeated create IDs independently', async () => {
    const h = await listen();
    const client = new Client({ name: 'node-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${h.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      expect((await client.listTools()).tools).toHaveLength(9);
      const input = { request_id: 'node-create-001', subscription: {
        name: 'Node fixture', price: { amount: '12', currency: 'CNY' }, billing: { interval: 1, unit: 'month' }, start_date: '2026-11-01', next_payment_date: '2026-11-01',
      } };
      const results = [];
      for (let i = 0; i < 2; i++) {
        results.push(contracts.wallos_create_subscription.output.parse((await client.callTool({ name: 'wallos_create_subscription', arguments: input })).structuredContent));
      }
      expect(results.every(r => r.ok)).toBe(true);
      expect(results[0].data?.subscription.subscription_id).not.toBe(results[1].data?.subscription.subscription_id);
      expect(h.fixture.writes).toHaveLength(2);
    } finally { await client.close(); }
  });

  it('serves a legacy call on a fresh process-equivalent instance without a session', async () => {
    const fixture = new Fixture();
    for (let i = 0; i < 2; i++) {
      const h = await listen(fixture);
      const response = await fetch(`${h.url}/mcp`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          Accept: 'application/json,text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wallos_get_context', arguments: {} } }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.has('MCP-Session-Id')).toBe(false);
      expect(await response.text()).toContain('default_currency');
      await h.close();
      cleanup.pop();
    }
  });
});
