# Wallos MCP

[English](README.md) | [简体中文](README.zh-CN.md)

A remote [Model Context Protocol](https://modelcontextprotocol.io/) server for [Wallos](https://github.com/ellite/Wallos), built with TypeScript and Cloudflare Workers. It exposes subscription-management tools through Streamable HTTP at `/mcp`.

The current milestone includes read tools and single-record writes (phases 1 and 2). Each deployment connects to one Wallos account.

## Tools

| Tool | Purpose |
| --- | --- |
| `wallos_get_context` | Available currencies, categories, household members, payment methods, timezone, and reminder-channel status |
| `wallos_search_subscriptions` | Search and filter records, with snapshot-bound pagination |
| `wallos_get_subscription` | Subscription details and a version digest for subsequent writes |
| `wallos_list_upcoming_payments` | The next recorded payment for each active subscription within a date range |
| `wallos_summarize_costs` | Scheduled monthly payments or monthly-equivalent costs across all active records |
| `wallos_create_subscription` | Create one record using business-level fields and exact reference resolution |
| `wallos_update_subscription` | Patch ordinary fields while preserving omitted values |
| `wallos_set_tracking_state` | Activate or deactivate a Wallos tracking record |
| `wallos_set_subscription_reminder` | Save a record's reminder toggle and lead time |

Resources: `wallos://reference-data` and `wallos://cost-policy`.

Changes affect Wallos records, not provider accounts or actual billing. Saving a reminder does not verify notification delivery. Upcoming payments have `next_payment_only` coverage; recurring-payment expansion, permanent deletion, auxiliary-data management, and bulk writes are outside this milestone. Administrative settings and automatic logo downloads are not exposed.

## Quick start

Use Node.js 24. The supported Node.js versions are listed in [`package.json`](package.json). You will also need a running Wallos instance with an account API key.

```bash
git clone https://github.com/p3psi-boo/wallos-mcp.git
cd wallos-mcp
npm ci
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your Wallos installation root, Wallos API key, and a separate MCP Bearer token. Generate the MCP token with:

```bash
openssl rand -hex 32
```

Then start the local Worker:

```bash
npm run dev
```

The default endpoint is `http://localhost:8787/mcp`. `npm run dev` also handles the npm workerd binary's ELF loader on NixOS using a compatible installed glibc loader. An explicit `MINIFLARE_WORKERD_PATH` takes precedence.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `WALLOS_BASE_URL` | Wallos installation root, including any subdirectory | Required |
| `WALLOS_API_KEY` | API key for the connected Wallos account | Required |
| `MCP_AUTH_TOKEN` | Independent client Bearer token, at least 32 characters | Required |
| `TIMEZONE` | IANA timezone used for business dates | `UTC` |
| `UPSTREAM_TIMEOUT_MS` | Upstream timeout, between 100 and 60,000 ms | `10000` |
| `ALLOW_HTTP_UPSTREAM` | Explicitly enable HTTP upstream connections for development | `false` |
| `ALLOWED_ORIGINS` | Comma-separated, exact browser Origin allowlist | Empty |

For a Wallos installation at `https://HOST/wallos/`, use that root rather than an `/api` endpoint. HTTP upstream URLs require `ALLOW_HTTP_UPSTREAM=true`.

The configured MCP token grants access to all nine tools for the connected account. Use separate deployments and tokens for separate accounts. Account identity, upstream credentials, and the upstream root URL are server configuration, not tool arguments. `payer_member` means a household member, not a Wallos login account. Subscription website URLs are ordinary record fields.

Requests without an Origin header work with desktop and command-line clients. Browser requests require an exact match in `ALLOWED_ORIGINS`. `GET /health` reports process liveness only; it does not probe Wallos connectivity.

## Deploy to Cloudflare

1. Set the production timezone and browser Origins in `wrangler.jsonc`. Keep the existing Durable Object binding and SQLite migration.
2. Copy `.env.production.example` to `.env.production` and fill in the three production values. The example MCP token must be replaced with a generated token.
3. Log in and deploy:

```bash
npm run check
npx wrangler login
npm run deploy -- --secrets-file .env.production
```

The deployment command uploads code and secrets together. Local `.dev.vars` values are not automatically published. The production secrets file is ignored by Git.

The Worker must be able to reach the configured Wallos HTTPS installation root. Durable Object storage is provisioned through the project configuration; no separate database server, KV namespace, or D1 database is needed.

Use the URL printed by Wrangler and append `/mcp`. Verify the deployed service with:

```bash
curl https://HOST/health
MCP_URL=https://HOST/mcp MCP_AUTH_TOKEN=TOKEN npm run smoke
```

For later deployments, `npm run deploy` retains existing secrets. You can update a value individually with `npx wrangler secret put WALLOS_API_KEY` or deploy another secrets file.

## Connect an MCP client

Choose **Streamable HTTP**, set the endpoint to `https://HOST/mcp`, and send:

```http
Authorization: Bearer TOKEN
```

Clients that use the following configuration shape can add:

```json
{
  "mcpServers": {
    "wallos": {
      "url": "https://HOST/mcp",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

Configuration syntax depends on the client. MCP Inspector can use the same endpoint and request header. Add its actual Origin to `ALLOWED_ORIGINS` when connecting directly from a browser.

Authentication uses a static Bearer token rather than an OAuth flow. The server supports modern MCP requests and stateless 2025 Streamable HTTP compatibility; there is no standalone `/sse` endpoint. Tool descriptions and business messages currently use Simplified Chinese; tool names and structured field names are English.

## Write behavior

All writes require a stable `request_id`. Updates also require the `subscription_id` and `expected_version` returned by the details tool.

```json
{
  "subscription_id": "42",
  "request_id": "price-update-001",
  "expected_version": "OFFSET",
  "changes": { "price": { "amount": "25.00", "currency": "CNY" } }
}
```

Replace `OFFSET` with the returned 64-character version digest. Amounts are decimal strings paired with currency codes. References accept an accessible ID, a unique exact name, or a matching ID/name pair. Ambiguous names return candidates before any write.

Omitted fields remain unchanged. `null` clears nullable notes, website URLs, category, payer, or payment-method fields. Changing the price does not recalculate the billing period or next payment date. Tracking state and reminders use their dedicated tools. For reminders, an omitted `days_before` preserves the value, `null` uses the account default, and `0` means the payment day.

A per-account Durable Object serializes writes and stores the operation ledger. MCP transport itself remains stateless. Repeating the same request returns the recorded result; changing its content returns `REQUEST_ID_CONFLICT`. A timeout or lost response may return `WRITE_OUTCOME_UNKNOWN`. Keep the request ID: retries reconcile a known target by reading, rather than resending an uncertain create.

Version checks are best-effort and do not lock writes from the Wallos web interface or guarantee exactly-once execution. Operation records do not expire automatically. Rotating the Wallos API key changes the ledger namespace; reconcile pending operations first. Rotating only the MCP token preserves the namespace. Replayed results describe the original operation, not necessarily the current record.

## Cost policy

- `monthly_equivalent`: daily prices use 30 days/month, weekly prices use 30/7 weeks/month, monthly prices use one month, and yearly prices use 1/12 year, each divided by the billing interval. Decimal arithmetic is aggregated per currency before rounding to two decimal places.
- `scheduled_payments`: reproduces the pinned Wallos monthly-cost calendar policy and checks comparable totals against the upstream monthly-cost endpoint. A disagreement returns `COST_CONTRACT_MISMATCH`.
- Month ends and leap days follow PHP overflow behavior rather than end-of-month clamping. Results include a message when those dates can affect the target month. Independently generated PHP fixtures cover calendar edges.
- Only active records are included; start dates and manual renewal follow the upstream monthly-cost policy. These estimates are not payment transactions or a complete forecast.
- Mixed currencies return original-currency subtotals with `total: null` and `exchange_rate_date: null`, because the read interface does not establish a verifiable exchange-rate timestamp.
- Wallos stores floating-point values; writes are checked against the values actually read back from Wallos.

## Development and tests

```bash
npm run check            # TypeScript and automated tests
npm run build            # Wrangler dry-run; no deployment
npm run schema:generate  # Regenerate types from pinned local OpenAPI files
npm run schema:refresh   # Explicitly download a fresh upstream schema snapshot
```

The test suite runs without Cloudflare credentials, a real Wallos account, or PHP. Calendar fixtures can optionally be regenerated with `php scripts/calendar-fixtures.php > test/data/calendar.json`.

A read-only contract probe against an explicitly configured Wallos instance:

```bash
WALLOS_BASE_URL=https://HOST/ WALLOS_API_KEY=TOKEN npm run contract
```

For a local end-to-end fixture, run `npm run mock`, configure `.dev.vars` with `WALLOS_BASE_URL="http://127.0.0.1:8080/"`, `WALLOS_API_KEY="secret-upstream-key"`, `ALLOW_HTTP_UPSTREAM="true"`, and your generated MCP token, then run `npm run dev` in another terminal.

```bash
MCP_AUTH_TOKEN=TOKEN npm run smoke
MCP_AUTH_TOKEN=TOKEN SMOKE_WRITES=true npm run smoke:write
```

The write probe creates one record, exercises replay, price updates, reminders, and tracking state, and leaves the record inactive. The fixture API key is a test constant, not a real credential. Fixture data resets when its process restarts; local Durable Object storage persists separately in `.wrangler/`.

See [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md) for implementation and source details. Deployment uses the locked dependencies; Agents 0.26.0 and its MCP v2 peers are pinned together at compatible versions.

## License

Original project code is licensed under [WTFPL 2.0](LICENSE). Third-party material retains its own terms and attribution; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
