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

## Portal implementation (2026-11-25)

Implemented Worker-rendered user and admin pages, existing session hash compatibility, login/logout, one-time pairing/invitation, calendar rotation, account settings and password change. User/admin actions use same-origin POST checks, escaped HTML, private responses, and persistent attempt throttling. Admins cannot modify owners or peer admins; owner manages non-owner accounts. Resetting identity revokes devices and pending codes, removes the source lock and bumps sync generation while preserving events. No actual production secrets are in the repository; staging needs original TOKEN_PEPPER, UID_SECRET and SESSION_SECRET. The UI is a minimal SSR replacement, not a pixel-identical port. Production Worker resource limits and real client behavior remain staging gates.

## Private migration export

Run only on a host that can read the source database, using the checked-out migration branch. Example: `python3 cloudflare-poc/scripts/export_sqlite.py --source /var/lib/seqta-calendar/seqta.db --output /secure/private-new-export`. This creates a new private directory, an online SQLite backup, a data-only SQL file and a per-table parity manifest. The source is opened read-only. All 12 original tables are replayed against the shipped target schema in memory and compared by counts and exact deterministic row digests before acceptance. The output is sensitive: never commit, upload to CI or share it. If export fails, do not use the incomplete files. Remote D1 import and parity validation remain a staging task. Import into a fresh database after applying 0001_schema.sql; do not import into an existing populated D1 database. No production export or deployment performed by this PR.

## Independent portal redesign

A new lightweight SSR design system replaces the temporary UI (not a port of the Flask templates). Responsive sidebar/navigation, overview metrics, upcoming lessons, date-range agenda with week navigation, account/connection status, and consistent admin controls. No external fonts, scripts or CDN assets. Existing auth, mutation paths, session cookies, sync/ICS and database schema remain unchanged. The user must accept the visual result on protected staging before production cutover.

## shadcn/ui calendar workspace

User rejected the interim UI and requested the actual shadcn/ui component system. Official New York v4 registry components vendored from shadcn-ui/ui commit 0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4 (MIT; see SHADCN-LICENSE.md); only cn imports adapted. React static server rendering, Tailwind v4 compiled at build time, Lucide icons; no browser hydration or external CDN. Custom time-grid layout composes the shared components. Week/day/agenda navigation uses links and forms; Sydney local times, exact minute-based event positions, collision lanes, adaptive hours, page-load current-time line. Existing auth, sync, ICS and schema are unchanged. Browser visual acceptance is required before production cutover.

## Calendar, admin and appearance

An authenticated owner can create a reusable subscription URL without invalidating legacy links. Newly registered accounts and deliberate rotations use managed token IDs and domain-separated HMAC derivation; only normal hashes are stored, no schema migration. Creation is same-origin POST and atomic/idempotent. Rotation revokes prior links. HTTPS and webcal, 15 minute refresh hint (clients control actual polling), Staging remains Access protected. Admin GET-only timetable routes for every non-deleted user; no raw tokens exposed to admin. Dark/light/system shadcn theme, local preference, reduced-motion support, static same-origin browser script handles clipboard and current-time indicator.

## Named subscriptions and compact UI

Apply 0002_subscription_clients.sql before deploying this build. Additive token metadata and bounded per-token client-family counters; no IP, raw user-agent, raw token or physical fingerprint collected. Successful authorized feed requests (including 304) record first/last fetch and fetch count. Old hashes remain irreversible and legacy links continue working. Named managed links allow separate devices or providers (max 20 active managed links); rename/revoke are owner-scoped same-origin POST. No inferred device count. New official shadcn breadcrumb/button-group/item/input-group/textarea components, compact hierarchy, visible copyable links, expandable management and instructions. Real browser/calendar-provider validation pending.

## Daily experience

Apply 0003_daily_experience.sql before deployment. Calendar-scoped display preferences, school term/holiday ranges with optional confirmed A/B anchor, source-aware day coverage, and latest authenticated device check; no modification to raw source events, subscriptions or credentials. Explicit SEQTA week/term/holiday metadata is authoritative when supplied; pattern inference requires four populated weeks and reports Cycle 1/2 rather than inventing A/B names. Potential free periods use complete-day evidence and recurring numbered periods; not confirmed free time. Live school day and detail sheet use same-origin browser JS, native dialog focus/escape and official shadcn components, no hydration. Admin health is a live query/telemetry panel, not external uptime monitoring. Browser/provider acceptance remains required.

Userscript 3.2.0 is bundled from tracked sources and must be installed manually until a release is published. It includes PR #2's canonical host migration (custom server/profile/token preservation), opt-in safe auto sync and school metadata. The Worker never runs a school-browser session itself.

## Production ICS snapshot v2

Subscription feeds contain only active confirmed events. Cancelled rows and aliases remain in the database for sync reconciliation and stable UID restoration; do not publish tombstones in a full snapshot subscription. The `calendar-v2-<revision>` ETag invalidates v1 representations without rewriting course rows or subscription credentials. Apple Calendar and other snapshot consumers refresh on their own schedule; cached cancelled events may need a manual refresh. No database migration required.
