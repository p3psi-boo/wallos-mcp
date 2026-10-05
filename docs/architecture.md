# Architecture and operation protocol

[English](architecture.md) | [简体中文](architecture.zh-CN.md)

## Components

```text
MCP client
    │ Streamable HTTP + Bearer token
    ▼
Node.js HTTP server /mcp
    │ independent request handling
    ▼
Account-scoped read and write services
    │ fixed-path, form-encoded API requests
    ▼
Wallos account (persistent business data)
```

The official SDK's `createMcpHandler` creates a fresh MCP server for each request. The Node transport adapter streams responses back to the HTTP client. The application has no sessions, database, operation ledger, request-result cache, or write queue. Configuration and reusable service objects live in process memory, but they retain no cross-request business history.

The upstream adapter is an internal implementation, not an arbitrary HTTP tool or an automatic OpenAPI-to-tools gateway. Tool inputs use business fields and account-scoped references. The full schema snapshot includes administrative endpoints for provenance and type generation, but the runtime tool set exposes only subscription tasks.

One deployment connects to the account selected by the configured Wallos key. `request_id` is returned for caller correlation only, not used to derive storage keys or request fingerprints. The caller may route subsequent requests to any equivalent replica without MCP session affinity.

## Independent write flow

```text
validate input and account-scoped references
    ↓
read record and check expected_version (edits only)
    ↓
check version once more immediately before sending
    ↓
send one upstream add/edit request
    ├── explicit upstream rejection → business error
    ├── lost / malformed response or missing created ID → WRITE_OUTCOME_UNKNOWN
    └── accepted response with known ID
            ↓
        read and compare submitted fields
            ├── matching read-back → verified result
            └── failed read-back or mismatch → WRITE_OUTCOME_UNKNOWN
```

Each tool call owns only its in-flight values. After the response, there is no retained operation to replay or recover. Repeated creates with the same ID are separate writes; content changes under that ID do not produce a request-ID conflict. The service never automatically retries a mutation within a request.

Unknown outcomes are not marked retryable. Inspect known targets using the read tool, or search for a potentially created record. Calling the write tool again is another execution, not a read-only recovery path. If execution succeeded but verification failed, even a later `NOT_FOUND` error is an uncertain outcome rather than proof the mutation was rejected.

Version checks cannot lock concurrent requests, replicas, the Wallos web interface, or other writers. Two requests can both pass before either writes. There is no atomic compare-and-update or exactly-once guarantee. An edit repeated with a stale version is revalidated, not replayed from history.

Read-back verification compares each submitted field, using Decimal comparison for prices. Results show actual before/after changes, including accompanying upstream changes. Raw upstream error bodies are not printed or returned.

## Runtime and deployment

`src/index.ts` reads process environment variables, validates startup configuration, and starts the Node.js HTTP listener. `src/node-http.ts` bounds the raw request body before adapting it; `src/http.ts` handles routing, Bearer authentication, exact browser Origin checks, and the SDK handler. Shutdown stops accepting requests and closes active MCP streams, with a 30-second deadline.

The compiled service runs with `npm start`. Docker Compose uses the same code as a non-root container; it requires no storage volume. HTTPS is terminated by a fronting reverse proxy. Replicas share only the configured Wallos account, not an application database or operation history.

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
