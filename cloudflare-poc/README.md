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

## Gate 1B: production-cost profile and legacy password checks

The tests add independently generated Python Argon2id m=65536 KiB, t=3, p=4 and the exact historical hashlib.scrypt n=16384,r=8,p=1,dklen=64 format. Actual stored production hash profiles remain unverified. Run host-side comparisons with:

```sh
node --experimental-strip-types scripts/benchmark-kdf.ts argon2
node --experimental-strip-types scripts/benchmark-kdf.ts scrypt
```

The CI reports native Node CPU and process peak RSS as development proxies, not Worker isolate memory or Cloudflare billable CPU. Workerd tests establish functional compatibility only. Cloudflare's published limits include 128 MB isolate memory and a 10 ms CPU budget on Workers Free. [Limits](https://developers.cloudflare.com/workers/platform/limits/). Default-profile hashing uses 64 MiB of Argon2 algorithm memory before runtime overhead; do not downgrade hashing or assert Free plan compatibility based on these tests. A remote, isolated, rate-limited benchmark with no actual users/data is a separate acceptance gate. No password or hash is exposed through Worker routes.

## 2026-11-25 — streamlined delivery decision (supersedes earlier staged checklist)

Prior evidence: [CI #45496519508](https://github.com/Nardo021/SEQTA-Link/actions/runs/45496519508), 11/11 tests plus build/typecheck and one-time Node resource measurements. Do not repeat the host benchmark in ordinary CI; the script remains available for regressions. The low-cost Argon2 test is superseded by the default-cost fixture, with malformed-input and excessive-cost rejection retained.

**Three remaining delivery stages:**
1. **Implement:** one implementation increment covering full D1 schema, existing login/admin/session/device API, transactional and idempotent sync, complete/partial/empty snapshot safeguards, stable ICS UIDs/token hashes and web UI. Preserve existing test coverage for external behavior and authorization. Choose the TypeScript Worker + D1 candidate; no separate Flask-on-Workers experiment unless a concrete blocker requires it. Keep one normal CI suite (build, typecheck, core contract tests); no repeated benchmark, per-module PoC, browser matrix, or unrelated tests. Pin dependencies/lockfile before staging.
2. **Stage and validate once:** use a consistent SQLite online backup and restricted D1 import; verify table counts, active events, existing identities/UIDs/token hashes and current API contracts. On isolated remote staging, check actual production password profile compatibility, real Worker resource limits and reasonable bounded login concurrency without lowering password costs. One integrated flow: login/authorization, actual userscript sync, replay/partial snapshot protection, ICS 200/304, subscription refresh. Verify rollback readiness. Use synthetic fixtures for CI and remote load checks; production snapshots/secrets stay private. Do not create separate validation stages for each component.
3. **Cut over:** freeze writes for a final consistent import (or proven equivalent), smoke-test current hostname and existing subscriptions, switch only the intended route; retain the old service and restorable backup. If new writes occur after cutover, reconcile them before rollback; do not silently lose them. Retire CT120 only after successful real-client verification, a retained rollback backup, and explicit owner authorization.

If Worker login exceeds its actual resource budget, do not downgrade KDFs: resolve the auth architecture or use the automated PVE fallback. No production change is authorized by this document.

## Implementation status (2026-11-25)

The isolated branch now contains a migration schema mirroring all existing Flask tables plus two additive Worker sync guard tables, and real `/health/live`, `/health/ready`, `/api/v2/status`, `/api/v2/sync`, and `/calendar/<token>.ics` handlers. Token and UID secrets must be provided as original base64 values; no defaults or real values are bundled. Imports must preserve existing IDs, hashes, timestamps, UIDs, status and sequence. The D1 sync engine reads a snapshot, applies an atomic batch guarded by calendar generation, authorization and source identity, and preserves cancellation/restore/idempotency semantics. No production writes or remote resources.

Remaining implementation (same compressed stage 1): session/login/portal/admin and pairing routes, exact migration export/import tooling and complete behavior review; do not deploy until completed. Actual Workers authentication CPU/memory, final data migration and real client smoke remain staging acceptance. The local CI uses synthetic data only. The schema is a source-derived migration definition, not evidence that the production database has already been imported.
