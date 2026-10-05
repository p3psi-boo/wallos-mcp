# Architecture and operation protocol

[English](architecture.md) | [简体中文](architecture.zh-CN.md)

## Components

```text
MCP client
    │ Streamable HTTP + Bearer token
    ▼
Cloudflare Worker /mcp
    │ internal RPC
    ▼
Per-account Durable Object
    ├── read services
    ├── serialized write queue
    └── persistent operation ledger
    │ fixed-path, form-encoded API requests
    ▼
Wallos account
```

`createMcpHandler` creates a fresh MCP server for each request. The Durable Object is for business state, not MCP sessions; this project does not use `McpAgent`. Its namespace key is a SHA-256 digest of the configured Wallos installation root and API key.

The upstream adapter is an internal implementation, not an arbitrary HTTP tool or an automatic OpenAPI-to-tools gateway. Tool inputs use business fields and account-scoped references. The full schema snapshot includes administrative endpoints for provenance and type generation, but the runtime tool set exposes only subscription tasks.

## Write state machine

```text
absent
  │ persist fingerprint, tool, started_at
  ▼
preparing
  │ validate fields, references, and version; persist prepared request
  ▼
dispatching
  │ send one upstream add/edit; save target ID; verify by reading
  ├── matching read-back ───────► done + result + completed_at
  ├── explicit rejection ──────► done + error
  └── timeout / bad response / read-back failure ──► unknown
```

On retry or recovery:

- A completed request returns its original result.
- Different content under the same request ID returns `REQUEST_ID_CONFLICT`.
- A pending request with a known target and prepared fields can be reconciled read-only.
- A request without a known target, or with a read-back mismatch, returns `WRITE_OUTCOME_UNKNOWN`. It is not redispatched.

An instance-level Promise queue serializes writes across asynchronous boundaries. Reads do not use that queue. The ledger is persisted before the outbound mutation, so eviction or restart cannot turn the same request into an automatic create retry.

There is still an uncertainty window between upstream execution and ledger completion. The adapter provides no exactly-once guarantee. Its version checks cannot lock the Wallos web interface or other writers; a change can occur after the last check.

Read-back verification compares each submitted field, using Decimal comparison for prices. Results show actual before/after changes, including accompanying upstream changes. The ledger contains account-private business data, not upstream API keys. Raw upstream error bodies are not printed or returned. Historical operation records currently have no automatic retention policy.

## Contracts and limits

- Object references resolve by accessible ID or unique exact name. Multiple matches return `AMBIGUOUS_REFERENCE`; a contradictory ID/name pair returns `REFERENCE_MISMATCH`.
- Updates use resolved subscription IDs. Ordinary fields, tracking state, and reminders belong to separate tools.
- Prices and currencies remain paired. Requests use `convert_currency=false` rather than relabeling converted values with original currency IDs.
- Strict input schemas reject unknown fields. Each tool has its own output schema, `structuredContent`, and the matching serialized JSON text. Business errors set `isError=true`.
- Success results carry retrieval time, coverage, and business messages. Errors carry a code, retryability, and recovery information, with candidates or operation/record IDs where needed.
- HTTP request bodies are limited to 64 KiB and upstream responses to 4 MiB. Oversized responses do not become misleading partial success results.

## Cost and date policy

The upcoming-payment tool reports only each record's next payment date. Cost summaries operate over all active subscriptions, not a search page. Monthly-equivalent costs and scheduled-month costs have distinct inputs and policy descriptions.

Scheduled monthly subtotals mirror the pinned PHP monthly-cost calendar semantics, including month/year overflow. Comparable single-currency results are checked against the upstream endpoint. Mixed currencies remain separate because the read contract does not establish a verifiable exchange-rate timestamp. The complete policy is available through `wallos://cost-policy`.

The PHP golden-fixture generator is an offline testing utility. The server and default test suite do not require PHP.

## OpenAPI provenance

`vendor/wallos/sources.json` records the download hashes of 25 upstream documents and the PHP contract reference commit. The checked-in YAML files are normalized and external references are changed to local paths; their byte hashes therefore differ from the original downloads.

The bundle removes the demo-server URL. Schema acquisition is an explicit build-time maintenance command; runtime tools never download schemas or accept a schema URL.

`src/wallos/generated.d.ts` is generated from the local bundle and constrains adapter paths. Runtime Zod schemas separately handle PHP response differences, including numeric strings, empty notification arrays, and nullable fields. The write endpoint is documented as multipart, but the supported operations contain no files and PHP reads `$_POST`, so the adapter uses `application/x-www-form-urlencoded`.

To review an upstream change:

1. Run the read-only `npm run contract` against the intended Wallos instance.
2. Refresh and review the schema snapshot, generated types, and PHP contract assumptions.
3. Regenerate calendar fixtures with `php scripts/calendar-fixtures.php > test/data/calendar.json` if date behavior changes.
4. Run `npm run check` and `npm run build` before deploying.

## Future scope

Permanent deletion and confirmation plans, full future-payment expansion, auxiliary-object management, and bulk mutations are not registered. Add dedicated contracts and tests for these capabilities rather than exposing an arbitrary HTTP proxy.
