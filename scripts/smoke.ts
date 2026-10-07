import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
const url = new URL(process.env.MCP_URL ?? 'http://localhost:8787/mcp');
const token = process.env.MCP_AUTH_TOKEN;
if (!token) throw new Error('Set MCP_AUTH_TOKEN.');
const client = new Client({ name: 'wallos-mcp-smoke', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, process.env.ENABLE_CONFIGURATION_TOOLS === 'true' ? 27 : 20);
  if (process.env.ENABLE_CONFIGURATION_TOOLS !== 'true') assert(!tools.some(t => /admin|oidc|fixer|password_login/.test(t.name)));
  assert(tools.every(t => t.outputSchema));
  const context = await client.callTool({ name: 'wallos_get_context', arguments: {} });
  assert.equal(context.isError, false);
  const result = context.structuredContent as { ok: boolean };
  assert(result.ok, JSON.stringify(context));
  const found = await client.callTool({ name: 'wallos_search_subscriptions', arguments: { limit: 2 } });
  assert.equal(found.isError, false);
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 3);
  const profile = await client.callTool({ name: 'wallos_get_profile', arguments: {} }); assert.equal(profile.isError, false);
  const calendar = await client.readResource({ uri: 'wallos://calendar' }); assert.equal(calendar.contents[0]?.mimeType, 'text/calendar');
  const policy = await client.readResource({ uri: 'wallos://cost-policy' });
  assert(policy.contents.length);
  console.log(JSON.stringify({ ok: true, tools: tools.map(t => t.name), resources: resources.resources.map(r => r.uri) }, null, 2));
} finally { await client.close(); }
