# Cloudflare Workers + D1 Auth Compatibility Spike

**Non-production. Test-only synthetic data. No production routes or remote resources.**

This spike tests the minimum dangerous compatibility boundaries before a Cloudflare rewrite:
- Crypto `HMAC-SHA256` token hash bytes and event `UID` match Flask/Python.
- pure JavaScript `@noble/hashes` Argon2 PHC verifier accepts an independent Python `argon2-cffi` fixture (small 1 MiB memory).
- A **local** D1 database can resolve active, disabled, and revoked hashed calendar subscriptions with revision ETags.
- The Worker itself is **fail-closed**: every URL returns 404, including `/calendar`. There is **no** live ICS, login, sync, or admin route.

## Run

In the `cloudflare-poc` directory:

```sh
npm install
npm test
npm run typecheck
npm run build
```

Tests run using Cloudflare's Vitest Workerd integration with an isolated **local D1** binding. No remote credentials or resources are required. The CI workflow is read-only, installs test dependencies, and does not call `cf deploy`. Cloudflare's new `cf` CLI is used as project configuration via `cloudflare.config.ts`, not Wrangler.

**Do not deploy this Worker.** `seqta-link-spike-local-only` is an intentionally nonexistent remote D1 name; the local test binding may be emulated. Do not attach real accounts, passwords, tokens, production SQLite data, or Cloudflare secrets.

## Required before advancing

1. Workerd CI succeeds; verify independent Python-generated Argon2 fixture in that runtime.
2. Benchmark **real default Argon2-cffi parameters** (often 64 MiB, 3 iterations, parallelism 4) for Worker CPU and memory usage; test legacy scrypt separately. Passing the 1 MiB fixture is NOT production auth approval.
3. Replace test-only D1 schema with actual D1 migration and replay current source's token handling, `last_used_at` mutations and disabled-feed semantics.
4. Add exact ICS formatting tests, cancelled events, auth session lifecycle, atomic idempotency and partial-week protections.
5. Independently validate Apple/Google subscription URL updates and a fresh Tampermonkey upload.
6. Create a separate staging Worker and D1 only after explicit technical acceptance; preserve CT120 and production routing.

See [migration gates](../docs/cloudflare-migration-gates.md) in Draft PR #2. This independent PR deliberately does not depend on the production userscript fix.

## Gate 1 finding: Wasm runtime compilation unavailable

The initial PoC ran `hash-wasm` and failed in actual Workerd with `CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder`. That library bundles base64 Wasm and compiles it dynamically at runtime. Cloudflare Workers require precompiled Wasm imports; replacing this library with plain JavaScript `@noble/hashes` is an experiment, not approval for production password verification. Keep this failure in the migration decision record. 
