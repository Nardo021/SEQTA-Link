# Seqta Link — Cloudflare migration gate (2026-11-24)

Status: **Design + local compatibility tests only. NOT deployed, not production-approved.**
Tracking: [Issue #1](https://github.com/Nardo021/SEQTA-Link/issues/1).
This document does not authorize changing DNS, production data, secrets, subscriptions, or PVE CT120.

## Verified starting state

- Production: PVE **CT120**, `192.168.2.41:3210` behind the Home Cloudflare Tunnel at `timetable.yanze.me`. Process, readiness and SQLite `quick_check` pass.
- The active Calendar 1 feed was tested using the **same existing token**: old subscribed hostname `timetable.leoze.top` returned **403**; replacing only its hostname with `timetable.yanze.me` returned **200**, `ETag: "calendar-5"`, and **824** valid ICS VEVENTs. This demonstrates host/path compatibility for that one token only; the calendar app has **not** been confirmed resubscribed.
- Two calendars exist. Calendar 1: 541 active confirmed events, latest upload 2026-11-23 (92 unchanged), latest event change 2026-10-13. Calendar 2: 317 active confirmed events, last upload 2026-08-05, zero active events on/after 2026-11-24; whether it is intentionally unused is unknown.
- Existing implementation: Flask + SQLAlchemy + file-based SQLite (WAL); Argon2-cffi passwords plus legacy scrypt verification; HMAC-peppered device/calendar tokens; server-side session records; HMAC-stable ICS UIDs; browser userscript.
- [PR #2](https://github.com/Nardo021/SEQTA-Link/pull/2) fixes the userscript's legacy default host and adds CI. Until merged and installed by clients, the original script may still use the old host.

## Architecture decision: evaluate, do not yet commit

**Preferred candidate to prototype:** TypeScript Worker + Hono router + D1, with Workers Static Assets for the web UI. Keep the external URL and contracts unchanged. This is a **candidate**, not a verified drop-in migration.

**Alternative:** Flask WSGI in Python Workers (supported by Cloudflare as of September 2026) + D1 binding. It **still requires** a D1 adapter to replace file-backed SQLAlchemy/SQLite, plus validation of dependencies, especially `argon2-cffi`. Flask support does not imply the existing application runs unmodified. Do a small deployable spike before choosing between stacks.

**Important security gate:** Cloudflare's Workers Node-compatible `node:crypto` does not support `argon2` or `argon2Sync`. Do not silently change password algorithms, force a reset, ship secrets to clients, or downgrade hashing. Prove and load-test a secure Worker-compatible verifier against **synthetic Argon2 hashes** (and legacy scrypt vectors) before porting authentication. If this gate fails, full migration is blocked.

D1 stores relational records. R2 is not needed for the present event-feed workload. A per-calendar concurrency solution must be chosen explicitly; existing `threading.Lock` is **process-local** and cannot serve as a distributed lock on Workers.

## Compatibility contracts — must be preserved

1. **Existing subscribers:** `GET /calendar/sl_cal_<token>.ics` must preserve the full token format, hashed lookup, non-leaking 404/410 semantics, 200/304 conditions, revision ETag, `text/calendar`, and cancelled events.
2. **Stable event identity:** preserve `events.id`, `calendars.id`, existing `ical_uid`, and `sequence`. New UID creation must use the exact bytes `HMAC-SHA256(UID_SECRET, "event:v1:" + calendarId + ":" + eventId)`, base64url no padding, suffix `@seqta.link`. Never regenerate IDs/UIDs as part of migration.
3. **Token integrity:** HMAC-SHA256 with `TOKEN_PEPPER` and message `"calendar:" + rawToken` / `"device:" + rawToken`, lowercase hex. Preserve token hashes and statuses across D1 import. **Never export raw tokens** (only hashes exist in the DB).
4. **Device sync:** `POST /api/v2/sync` accepts the same bearer-token, schemaVersion 1, Idempotency-Key, student identity, and coverage semantics. `GET /api/v2/status` is backward compatible. Replays must not mutate counts or event revision.
5. **Safety:** only complete coverage may cancel omitted lessons; partial/failed weeks must not delete events. Preserve anti-empty-snapshot confirmation, duplication handling, account status, session/login flows and admin authorization.
6. **Calendar clients:** continue serving the current hostname `timetable.yanze.me` and exact tokenized paths. Client-side old `timetable.leoze.top` references need migration; old-domain HTTP 403 is not resolved by backend rewriting alone.
7. **Privacy:** no raw subscriber/device URLs, credentials, email, student identifiers or lesson contents in CI logs, GitHub, shared Notion, telemetry, or test fixtures.

### Deterministic, synthetic crypto vectors

Use `TOKEN_PEPPER = b"x" * 32` and `UID_SECRET = b"y" * 32` **in tests only** (never as production secrets).

| Input | Expected |
| --- | --- |
| HMAC(calendar, `sl_cal_fixture_please_do_not_use_as_secret`) | `6476eb6b120207962d91aca225a38bc4dc2efa68b2621f6c393494f7c4be63f0` |
| HMAC(device, `sl_dvc_fixture`) | `abe94f4d7ac51798148861957e78336b032bf6e85c7d85a8c9ff849c97080086` |
| UID(`cal-fixed-01`, `evt-fixed-01`) | `TU3ivCe5WD3fTmf9vAprFaHSm5WszzJ_qOufOht6yPs@seqta.link` |

`tests/test_migration_contract.py` tests these vectors and the current Flask ICS response. Future Worker implementation must pass equivalent tests with the **same** values; passing Python tests alone does not prove the Worker implementation.

## Staged delivery gates

- **Gate 0 / current PR:** Preserve baseline with CI-green synthetic contract tests, current route/crypto audit, and user's independent calendar-client resubscribe verification. No deployment.
- **Gate 1 / isolated spike:** Evaluate Python/Flask and TS/Hono under actual Workers runtime; verify Argon2, scrypt, D1 I/O and UTC/Sydney ICS behavior with synthetic data. Record decision, benchmarks, and blockers.
- **Gate 2 / parity:** Implement and test all route/auth/portal/admin/ICS contracts; prove concurrency and atomic idempotent sync in D1; include malicious/partial-week tests.
- **Gate 3 / data migration rehearsal:** Make a consistent SQLite backup using SQLite's online backup mechanism, separate from source WAL; take `quick_check`; prepare D1-compatible SQL import; use an isolated D1 database and restricted access; compare per-table counts, token hashes, events, revision, stable UID, timezones, cancelled events and server-side sessions. **Never attach production DB or its dump to GitHub or CI.**
- **Gate 4 / staging E2E:** Validate existing real tokens only in a tightly controlled staging environment after approval and protected secret handling; test userscript upload, login, admin, ICS 200/304, Apple/Google subscription, repeated sync and rollback. No test should rotate a production token.
- **Gate 5 / cutover:** Back up and verify source, establish a short write freeze or a demonstrably correct dual-write/replication plan, import the final consistent snapshot, run smoke and parity checks, then change only the intended production hostname routing. Roll back to CT120 if any gate fails. Preserve old service/backup for an agreed observation period.
- **Gate 6 / retirement:** Retire CT120 **only on a separate explicit user authorization** after external calendar client validation and rollback-retention sign-off.

## Current unresolved questions

- Did the user actually replace the subscribed URL in Apple/Google Calendar, and did those applications refresh after the 200 feed test?
- Does the current browser have PR #2's new userscript installed and configured to upload to `timetable.yanze.me`? The 2026-11-23 upload success alone does not confirm it is current today.
- Is Calendar 2 dormant intentionally?
- Is Argon2 verification reliable and safe in the intended Workers runtime? Does the existing SQLite schema import without D1-specific adaptations?
- Which Cloudflare runtime/framework passes the isolated spike and all public API contracts?

## Reference docs (verified 2026-11-24)

- [Cloudflare: Flask on Python Workers](https://developers.cloudflare.com/workers/languages/python/packages/flask/)
- [Cloudflare: Query D1 from Python Workers](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/)
- [Cloudflare: D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Cloudflare: D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare: Workers crypto compatibility (`argon2` unsupported in node:crypto)](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
