// Read-only contract probe against an explicitly configured deployment.
import { readConfig, type Env } from '../src/config';
import { WallosClient } from '../src/wallos/client';
import { ReadService } from '../src/domain/reads';
import { contracts } from '../src/tools/contracts';
const config = readConfig(process.env as unknown as Env);
const api = new WallosClient(config);
const reads = new ReadService(api, config);
const context = await reads.context();
contracts.wallos_get_context.output.parse({ ok: true, data: context, meta: { retrieved_at: new Date().toISOString(), coverage: 'complete' }, warnings: [] });
const search = await reads.search(contracts.wallos_search_subscriptions.input.parse({ limit: 1 }));
contracts.wallos_search_subscriptions.output.parse(search);
if (search.data.items.length) await reads.detail(search.data.items[0].subscription_id);
await reads.costs({ basis: 'monthly_equivalent' });
await reads.costs({ basis: 'scheduled_payments', month: context.today.slice(0, 7) });
console.log(JSON.stringify({ ok: true, mode: 'read-only', subscriptions: search.data.total_matches, currencies: context.currencies.length, timezone: context.timezone }));
