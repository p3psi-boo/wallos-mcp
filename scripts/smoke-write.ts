// Explicit opt-in single-record writes. Intended for the included local Wallos fixture.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contracts } from '../src/tools/contracts';
const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp');
if (process.env.SMOKE_WRITES !== 'true') throw new Error('Set SMOKE_WRITES=true to run the single-record write probe.');
if (!process.env.MCP_AUTH_TOKEN) throw new Error('Set MCP_AUTH_TOKEN.');
const client = new Client({ name: 'wallos-write-smoke', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } } }));
  const context = contracts.wallos_get_context.output.parse((await client.callTool({ name: 'wallos_get_context', arguments: {} })).structuredContent).data!;
  const request_id = `smoke:${randomUUID()}`;
  const input = { request_id, subscription: { name: `MCP smoke ${request_id}`, price: { amount: '1200.00', currency: context.default_currency }, billing: { interval: 1, unit: 'year' }, start_date: context.today, next_payment_date: context.today } };
  const created = contracts.wallos_create_subscription.output.parse((await client.callTool({ name: 'wallos_create_subscription', arguments: input })).structuredContent);
  assert(created.ok, JSON.stringify(created));
  let s = created.data!.subscription;
  const updated = contracts.wallos_update_subscription.output.parse((await client.callTool({ name: 'wallos_update_subscription', arguments: { request_id: `${request_id}:update`, subscription_id: s.subscription_id, expected_version: s.version, changes: { price: { amount: '2400', currency: s.price.currency } } } })).structuredContent);
  assert(updated.ok, JSON.stringify(updated)); assert.equal(updated.data!.subscription.billing.unit, 'year');
  s = updated.data!.subscription;
  const reminded = contracts.wallos_set_subscription_reminder.output.parse((await client.callTool({ name: 'wallos_set_subscription_reminder', arguments: { request_id: `${request_id}:reminder`, subscription_id: s.subscription_id, expected_version: s.version, enabled: true, days_before: 2 } })).structuredContent);
  assert(reminded.ok, JSON.stringify(reminded)); s = reminded.data!.subscription;
  const disabled = contracts.wallos_set_tracking_state.output.parse((await client.callTool({ name: 'wallos_set_tracking_state', arguments: { request_id: `${request_id}:state`, subscription_id: s.subscription_id, expected_version: s.version, tracking_state: 'inactive' } })).structuredContent);
  assert(disabled.ok, JSON.stringify(disabled)); assert.equal(disabled.data!.subscription.tracking_state, 'inactive');
  console.log(JSON.stringify({ ok: true, subscription_id: s.subscription_id, request_id, verified: ['create', 'update', 'reminder', 'tracking-state'] }));
} finally { await client.close(); }
