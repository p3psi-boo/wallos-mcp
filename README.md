# Wallos MCP

[English](README.md) | [简体中文](README.zh-CN.md)

A stateless, self-hosted [Model Context Protocol](https://modelcontextprotocol.io/) HTTP server for [Wallos](https://github.com/ellite/Wallos), built with TypeScript and Node.js. It exposes 20 account-management tools by default and seven optional configuration tools through Streamable HTTP at `/mcp` and runs as a Node.js process or Docker container.

Each deployment connects to one Wallos account. The MCP service has no sessions, database, operation ledger, request deduplication, or write queue. Wallos is the only persistent business-data source.

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
| `wallos_get_profile` | Read profile and budget; exclude credentials |
| `wallos_export_calendar` | Export an authenticated ICS calendar, preserving original currencies |
| `wallos_create_reference` | Create a category, household member, payment method or currency |
| `wallos_update_reference` | Patch a reference with its version; preserve omitted fields |
| `wallos_delete_reference` | Preview and confirm deletion of an unused, non-default reference |
| `wallos_delete_subscription` | Preview and confirm permanent record deletion and link cleanup |
| `wallos_set_subscription_replacement` | Link an existing replacement and deactivate the old record, or clear the link |
| `wallos_set_subscription_logo` | Set a logo from a public HTTPS URL or bounded image upload |
| `wallos_set_payment_method_icon` | Set an existing payment method icon |
| `wallos_get_preferences` | Read account UI preferences with a version |
| `wallos_update_preferences` | Patch UI preferences, theme, colors and CSS |

### Optional configuration group

Set `ENABLE_CONFIGURATION_TOOLS=true` and configure `MCP_CONFIRMATION_KEY` to additionally register:

| Tool | Purpose |
| --- | --- |
| `wallos_get_fixer_settings` | Read provider configuration without its key |
| `wallos_update_fixer_settings` | Preview and confirm Fixer/APILayer key configuration |
| `wallos_get_admin_settings` | Read global administrator settings without SMTP secrets |
| `wallos_update_admin_settings` | Preview and confirm global administrator changes |
| `wallos_get_oidc_settings` | Read OIDC configuration and environment-managed fields |
| `wallos_update_oidc_settings` | Preview and confirm OIDC configuration changes |
| `wallos_set_password_login` | Preview and confirm the OIDC password-login toggle |

Resources: `wallos://reference-data`, `wallos://cost-policy`, and `wallos://calendar` (`text/calendar`).

Changes affect Wallos records, not provider accounts or actual billing. Saving a reminder does not verify notification delivery. Upcoming payments have `next_payment_only` coverage. Full future-payment expansion, bulk transactions, budget writes, and notification-channel writes are not included. The latter writes have no endpoints in the current OpenAPI. See the [endpoint coverage and orchestration](docs/openapi-coverage.md).

## Quick start

Use Node.js 24. The supported Node.js versions are listed in [`package.json`](package.json). You will also need a running Wallos instance with an account API key.

```bash
git clone https://github.com/p3psi-boo/wallos-mcp.git
cd wallos-mcp
npm ci
cp .env.example .env
```

Edit `.env` with your Wallos installation root, Wallos API key, and a separate MCP Bearer token. Generate the MCP token with this command; run it separately for `MCP_CONFIRMATION_KEY`:

```bash
openssl rand -hex 32
```

Build and start the server:

```bash
npm run build
npm start
```

The default endpoint is `http://127.0.0.1:8787/mcp`. `npm start` and `npm run dev` load an optional `.env` file; existing process environment variables take precedence. For local development with automatic restarts, use `npm run dev` instead of building and starting.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `WALLOS_BASE_URL` | Wallos installation root, including any subdirectory | Required |
| `WALLOS_API_KEY` | API key for the connected Wallos account | Required |
| `MCP_AUTH_TOKEN` | Independent client Bearer token, at least 32 characters | Required |
| `HOST` | HTTP listen address | `127.0.0.1` |
| `PORT` | HTTP listen port, 1–65535 | `8787` |
| `TIMEZONE` | IANA timezone used for business dates | `UTC` |
| `UPSTREAM_TIMEOUT_MS` | Upstream timeout, between 100 and 60,000 ms | `10000` |
| `ALLOW_HTTP_UPSTREAM` | Explicitly allow HTTP connections to Wallos | `false` |
| `ALLOWED_ORIGINS` | Comma-separated, exact browser Origin allowlist | Empty |
| `MCP_CONFIRMATION_KEY` | Independent random signing key, at least 32 characters; required for deletion previews and the configuration group | Unset |
| `ENABLE_CONFIGURATION_TOOLS` | Enable seven provider/admin configuration tools | `false` |
| `WALLOS_FIXER_API_KEY` | Provider key referenced by `use_configured` | Unset |
| `WALLOS_SMTP_PASSWORD` | SMTP password referenced by `use_configured` | Unset |
| `WALLOS_OIDC_CLIENT_SECRET` | OIDC secret referenced by `use_configured` | Unset |

For a Wallos installation at `https://HOST/wallos/`, use that root rather than an `/api` endpoint. HTTP upstream URLs require `ALLOW_HTTP_UPSTREAM=true`.

The configured MCP token grants access to all enabled tools for the connected account. The configuration group is disabled by default; enabling it does not override Wallos account privileges. Use separate deployments and tokens for separate accounts. Account identity, upstream credentials, and the upstream root URL are server configuration, not tool arguments. `payer_member` means a household member, not a Wallos login account. Subscription website URLs are ordinary record fields.

Requests without an Origin header work with desktop and command-line clients. Browser requests require an exact match in `ALLOWED_ORIGINS`. `GET /health` reports process liveness only; it does not probe Wallos connectivity.

## Self-hosted deployment

### Node.js

Copy `.env.example` to `.env`, configure the Wallos root and credentials, then run:

```bash
npm ci
npm run check
npm run build
npm start
```

Run the process under your service manager. The default listener is loopback; set `HOST=0.0.0.0` when a container or another machine must reach it. For a public HTTPS endpoint, place an HTTPS reverse proxy in front of the service and preserve the Authorization header and streamed responses.

### Docker Compose

Docker deployment needs Docker Engine with Compose; Node.js does not need to be installed on the host. Copy `.env.example` to `.env`, fill in the Wallos root and credentials, then run:

```bash
docker compose up -d --build
docker compose logs -f wallos-mcp
```

Compose exposes `http://127.0.0.1:8787/mcp` by default. It overrides the container's `HOST` and `PORT` to `0.0.0.0:8787`; optional `MCP_BIND_ADDRESS` and `MCP_PORT` configure the host-side port binding. The image runs as a non-root user. No database or data volume is needed.

The configured Wallos root must be reachable from the process or container. Inside Docker, `127.0.0.1` refers to the MCP container itself; use a reachable hostname or the Wallos service name on a shared Docker network. HTTP roots require `ALLOW_HTTP_UPSTREAM=true`.

Verify the service:

```bash
curl http://127.0.0.1:8787/health
MCP_URL=http://127.0.0.1:8787/mcp MCP_AUTH_TOKEN=TOKEN npm run smoke
```

The service needs no separate database or persistent storage. The `.env` file is ignored by Git and excluded from the Docker build context.

## Connect an MCP client

Choose **Streamable HTTP** and use the endpoint for your deployment:

| Deployment | Endpoint |
| --- | --- |
| Default local Node.js or Compose | `http://127.0.0.1:8787/mcp` |
| Behind an HTTPS reverse proxy | `https://HOST/mcp` |

Send the MCP token from your server configuration in the request header:

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

All writes require a `request_id` for correlation only. It is **not an idempotency key**.

For an update, first call `wallos_get_subscription`. Use the returned `data.subscription_id` as `subscription_id` and `data.version` as `expected_version`:

```json
{
  "subscription_id": "42",
  "request_id": "price-update-001",
  "expected_version": "OFFSET",
  "changes": { "price": { "amount": "25.00", "currency": "CNY" } }
}
```

Replace `OFFSET` with the returned SHA-256 version digest: 64 hexadecimal characters. Amounts are decimal strings paired with currency codes. References accept an accessible ID, a unique exact name, or a matching ID/name pair. Ambiguous names return candidates before any write.

Omitted fields remain unchanged. `null` clears nullable notes, website URLs, category, payer, or payment-method fields. Changing the price does not recalculate the billing period or next payment date. Tracking state and reminders use their dedicated tools. For reminders, an omitted `days_before` preserves the value, `null` uses the account default, and `0` means the payment day.

Every execution request independently validates inputs and references, checks versions for edits, sends at most one upstream mutation, and reads back observable fields. Previews send no mutation; media and masked secrets report explicit partial verification. The service stores no request history and does not serialize writes. Repeating a create request, even with the same ID and identical content, can create another record. Reusing an ID with different content is not rejected.

A timeout, lost response, missing created ID, or failed read-back may return `WRITE_OUTCOME_UNKNOWN` with `retryable: false`. The server does not automatically resend the mutation or reconcile it on a later write request. Inspect a known target with the details tool; otherwise search by name, payer, and price before deciding what to do. A repeated edit with an old version can return `VERSION_CONFLICT` rather than replaying its previous success.

Version checks are best-effort: they do not provide upstream atomic compare-and-update or lock concurrent requests, replicas, or the Wallos web interface. There is no exactly-once guarantee. Replicas need no shared database or session affinity, but concurrent writes can race. Restarting the service retains no operation history; API-key rotation simply selects the account accessible with the new key.

## Stateless orchestration and confirmation

- **References**: `get_context` → create/update a reference → use the returned ID/version when creating or updating a subscription. `kind` is strictly `category`, `household_member`, `payment_method`, or `currency`, with per-kind fields. Context includes `in_use`, `enabled`, `order`, versions and currency management metadata; unavailable usage status is `null`. Disabled payment methods remain manageable but cannot be selected for new subscription references. Household emails appear only in explicit object-write results or profile data, not context.
- **Replacement**: create the new subscription and obtain its version → read the old record → call `wallos_set_subscription_replacement` with both versions. Linking deactivates the old record; clearing the link does not reactivate it. Creation and linking are independent writes, not a cross-call transaction with automatic compensation.
- **Deletion**: read the version → preview (default `dry_run=true`) → show the impact and obtain caller confirmation → execute with the same intent, `dry_run=false`, and `confirmation_token`. Subscription deletion checks replacement-link cleanup; in-use references and the default currency are blocked.
- **Preferences**: `get_preferences` → versioned partial `update_preferences`; read-side `custom_css/custom_colors` are mapped to write-side `css/main_color/accent_color/hover_color`.
- **Configuration**: enable the group → corresponding `get_*_settings` → preview → confirm and execute. Secret fields accept only `use_configured` or `clear`; omission preserves the value. Actual secrets come from server environment variables. Fixer requires an explicit key action; `clear` removes the provider configuration and does not refresh rates.

Deletion example (two calls to `wallos_delete_subscription`):

```json
{
  "subscription_id": "42",
  "request_id": "delete-preview-001",
  "expected_version": "OFFSET",
  "dry_run": true
}
```

For execution, retain the target/version, set `dry_run=false`, and add the returned `data.confirmation_token`. Tokens expire after five minutes and bind the account, operation, version, parameters, and deletion impact. Configured-secret references also bind the current server-secret digest. A token proves the previewed intent, not single-use or idempotent execution. Replicas only need the same signing key, not a database; rotating the signing key or account key invalidates old confirmations.

Images accept at most **32 KiB** of PNG/JPEG base64 (the entire MCP request remains limited to **64 KiB**) or public HTTPS URLs on the default port. DNS/public-address checks precede the request, but Wallos performs the actual fetch; its redirect/SSRF protections must remain active. Re-encoded images report only a stored reference: `verification: stored_reference_only`, `verified: false`, and partial coverage. Masked SMTP/Fixer/OIDC secrets report `read_back_except_secrets`, not verification of secret contents or service availability. Versions detect only observable read changes; fixed upstream secret masks may hide secret-only changes.

## Cost policy

- `monthly_equivalent`: daily prices use 30 days/month, weekly prices use 30/7 weeks/month, monthly prices use one month, and yearly prices use 1/12 year, each divided by the billing interval. Decimal arithmetic is aggregated per currency before rounding to two decimal places.
- `scheduled_payments`: reproduces the pinned Wallos monthly-cost calendar policy and checks comparable totals against the upstream monthly-cost endpoint. A disagreement returns `COST_CONTRACT_MISMATCH`.
- Month ends and leap days follow PHP overflow behavior rather than end-of-month clamping. Results include a message when those dates can affect the target month. Independently generated PHP fixtures cover calendar edges.
- Only active records are included; start dates and manual renewal follow the upstream monthly-cost policy. These estimates are not payment transactions or a complete forecast.
- Mixed currencies return original-currency subtotals with `total: null` and `exchange_rate_date: null`, because the read interface does not establish a verifiable exchange-rate timestamp.
- Wallos stores floating-point values; writes are checked against the values actually read back from Wallos.

## Development and tests

```bash
npm run dev              # Run from source with automatic restarts
npm run check            # TypeScript and automated tests
npm run build            # Compile the Node.js server into dist/
npm run schema:generate  # Regenerate types from pinned local OpenAPI files
npm run schema:refresh   # Explicitly download a fresh upstream schema snapshot
```

The test suite runs without a real Wallos account or PHP and includes real Node.js HTTP transport tests. Calendar fixtures can optionally be regenerated with `php scripts/calendar-fixtures.php > test/data/calendar.json`.

A read-only contract probe against an explicitly configured Wallos instance:

```bash
WALLOS_BASE_URL=https://HOST/ WALLOS_API_KEY=TOKEN npm run contract
```

For a local end-to-end fixture, run `npm run mock`, configure `.env` with `WALLOS_BASE_URL="http://127.0.0.1:8080/"`, `WALLOS_API_KEY="secret-upstream-key"`, `ALLOW_HTTP_UPSTREAM="true"`, and your generated MCP token, then run `npm run dev` in another terminal.

```bash
MCP_AUTH_TOKEN=TOKEN npm run smoke
MCP_AUTH_TOKEN=TOKEN SMOKE_WRITES=true npm run smoke:write
```

The write probe creates one record, exercises price updates, reminders, and tracking state, and leaves the record inactive. The fixture API key is a test constant, not a real credential. Fixture data resets when its process restarts; the MCP server has no separate persistent state.

See [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md) for implementation and source details. Deployment uses locked dependencies, with compatible MCP server/client/Node transport packages pinned together.

## License

Original project code is licensed under [WTFPL 2.0](LICENSE). Third-party material retains its own terms and attribution; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
