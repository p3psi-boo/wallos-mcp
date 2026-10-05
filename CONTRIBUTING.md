# Contributing

Use Node.js 24 and install the pinned dependencies with `npm ci`.

## Before submitting a change

```bash
npm run check
npm run build
```

The default tests use local fixtures. They do not need a real Wallos account or PHP. Node.js HTTP tests listen on ephemeral loopback ports. Keep tests deterministic and add cases for changed business behavior.

Documentation is available in [English](README.md) and [Simplified Chinese](README.zh-CN.md). Keep both versions aligned when changing setup, deployment, configuration, tool behavior, or supported scope. Preserve the distinction between Wallos records and provider actions, scheduled estimates and actual transactions, and reminder settings and delivered notifications.

## Tool and write changes

- Define strict input and output schemas in `src/tools/contracts.ts`.
- Resolve references deterministically against the connected account.
- Keep ordinary updates, tracking state, and reminder writes separate.
- Test independent repeated requests, concurrent writes, response loss, version conflicts, and read-back verification for mutation changes. Keep request IDs as correlation only; do not introduce a ledger, deduplication cache, or write queue.
- Keep credentials and upstream roots in server configuration, not tool arguments.

## Upstream schema changes

```bash
npm run schema:refresh
npm run check
npm run build
```

Review changes to the source manifest, local bundle, and generated types together. Do not edit `src/wallos/generated.d.ts` directly. The PHP contract commit is a separately verified reference; downloading a new OpenAPI snapshot does not update that reference automatically.

## Issues and pull requests

Describe the behavior, expected result, reproduction steps, and relevant versions. Use fixture data or redact credentials and personal account data in logs and examples. Keep unrelated behavior changes in separate pull requests.

Original project contributions use the repository's [WTFPL 2.0 license](LICENSE). Preserve attribution and existing terms for third-party material.
