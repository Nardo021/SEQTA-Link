# Seqta Link — HTTP API

**Product:** Seqta Link **v2.1.1**  
Base URL example: `https://timetable.leoze.top`

## Tokens

| Kind | Prefix | Used for |
|------|--------|----------|
| Upload | `scu_…` | `POST /api/v1/sync`, `GET /api/v1/status` |
| Device | `dvc_…` | `POST /api/v1/sync`, `GET /api/v1/status` (recommended) |
| Calendar | `scc_…` | `GET /calendar/:token.ics` (in URL) |
| Session cookie | `seqta_session` | Portal `/api/me/*`, Admin `/api/admin/*` |

Sync headers:

```http
Authorization: Bearer <upload-or-device-token>
Idempotency-Key: <uuid>
Content-Type: application/json
```

## Health

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/health/live` | Process up |
| `GET` | `/health/ready` | Postgres, migrations, role pools |

## Sync & status

### `POST /api/v1/sync` / `GET /api/v1/status`

Accepts upload (`scu_…`) or device (`dvc_…`) bearer tokens. Sync body is schema version 1 (`coverage`, `lessons`). Status never returns tokens or student PII. Idempotent when the same `Idempotency-Key` and payload are retried.

Status response keeps a compatibility `feed` object (`name`, `timezone`, `revision`) plus `sync` / `events` / `device` summaries.

There is **no** separate `/api/device/status` or `/api/device/sync` — userscripts and clients use `/api/v1/*` after pairing.

### `POST /api/device/pair`

Body: `{ "code": "ABCD-EFGH", "deviceName": "…" }` → `{ deviceToken }`.

This is the only public device endpoint. Pairing codes are created from the portal (`POST /api/me/pairing-codes`, 10 minutes, one-time). Failed pair attempts are lockout-protected per IP.

## Calendar feed

### `GET /calendar/:token.ics`

RFC 5545 ICS for Apple Calendar, Google Calendar (desktop URL subscribe), and Android (sync after desktop add).

| Header | Value |
|--------|--------|
| `Content-Type` | `text/calendar; charset=utf-8` |
| `Cache-Control` | `private, no-cache, max-age=0, must-revalidate` |
| `ETag` | `"calendar-<revision>"` |
| `Last-Modified` | HTTP date of last feed change |

- `If-None-Match` matching the ETag (strong or `W/`) → `304`
- Invalid token → `404` (empty body, no leak)
- Feed disabled → `410` with plain text (not an empty ICS)
- Events: stable HMAC `UID` (no student PII), `SEQUENCE` on content change, `STATUS:CONFIRMED` / `CANCELLED`
- Default calendar name / `PRODID`: Seqta Link
- Setup guides: `/help/apple.html`, `/help/google.html`

## Local auth

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/auth/login` | `{ email, password }` → session cookie |
| `POST` | `/auth/logout` | Clears session |
| `GET` | `/auth/login` | Redirects to `/app/login.html` |
| `POST` | `/auth/dev-login` | Dev/test only when `AUTH_DEV_LOGIN=true` |

New accounts require an invitation (no public registration). Owner accounts are created only via CLI `bootstrap-owner` or first-boot `OWNER_BOOTSTRAP_*` when no owner exists. Login never auto-promotes roles.

Static UI: `/app` (user portal), `/admin` (owner/admin), `/invite.html` (accept invite).

## Invitations

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/invite/:token` | Public preview |
| `POST` | `/api/invite/:token/accept` | Public; body `{ email, password, displayName? }` → creates user + session |
| `POST` | `/api/admin/invitations` | Admin session |

## Portal & admin

### User API (`seqta_session`)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/me` | Account + calendar summary |
| `GET` | `/api/me/dashboard` | Stats, devices, source identity |
| `GET` | `/api/me/timetable` | `?from&until` events |
| `GET` | `/api/me/calendar` | Token prefix + path hint (full URL only via rotate) |
| `POST` | `/api/me/calendar/rotate-token` | Returns one-time `calendarUrl` |
| `GET` | `/api/me/devices` | List devices |
| `DELETE` | `/api/me/devices/:deviceId` | Revoke device |
| `GET` | `/api/me/pairing-codes` | Pending unused codes (id + expiry; plaintext shown only at create) |
| `POST` | `/api/me/pairing-codes` | `{ code, expiresAt }` — 10 minutes, one-time |
| `DELETE` | `/api/me/pairing-codes/:pairingCodeId` | Cancel pending code |
| `GET` | `/api/me/sync-runs` | History with device name, error, duration |
| `PATCH` | `/api/me/preferences` | `{ calendarName? }` |
| `POST` | `/api/me/password` | `{ currentPassword, newPassword }` → revokes sessions |

Static UI: `/app/*` (dashboard, devices, calendar, sync history, timetable, account).

### Admin API (`seqta_session` + `owner` / `admin`)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/admin/dashboard` | Counts + recent audit |
| `GET` | `/api/admin/users` | All users |
| `GET` | `/api/admin/users/:userId` | User + calendar + source identity |
| `PATCH` | `/api/admin/users/:userId` | `{ displayName?, maxDevices?, syncEnabled?, feedEnabled? }` |
| `GET` | `/api/admin/users/:userId/timetable` | `?from&until` |
| `GET` | `/api/admin/users/:userId/sync-runs` | History with device names |
| `GET` | `/api/admin/users/:userId/devices` | Devices |
| `POST` | `/api/admin/users/:userId/suspend` | Revokes devices + sessions |
| `POST` | `/api/admin/users/:userId/activate` | |
| `POST` | `/api/admin/users/:userId/reset-source-identity` | `{ confirmName }` must match display name |
| `POST` | `/api/admin/users/:userId/rotate-calendar-token` | Returns new `calendarUrl` |
| `POST` | `/api/admin/devices/:deviceId/revoke` | |
| `POST` | `/api/admin/invitations` | `{ expectedName?, note?, syncEnabled?, feedEnabled?, maxDevices?, expiresInHours? }` |
| `GET` | `/api/admin/invitations` | |
| `DELETE` | `/api/admin/invitations/:invitationId` | Unused only |
| `GET` | `/api/admin/audit-logs` | `?limit&action` — includes actor/target display names + requestId |

Static UI: `/admin/*` (dashboard, users, user detail, invitations, audit). Non-admin login to `/admin/login.html` is rejected.

Sync / feed enablement is edited only via `PATCH /api/admin/users/:userId` (`syncEnabled`, `feedEnabled`) — there are no separate toggle routes.

## Rate limits & lockout

| Surface | Protection |
|---------|------------|
| `POST /auth/login` | IP rate limit + failed-attempt lockout (IP and email) → `429 RATE_LIMITED` |
| Invite preview / accept | IP rate limit + failed-attempt lockout (IP and invite token) |
| Upload/device bearer, calendar URL, device pair | Failed auth lockout per IP; route rate limits on sync/status/calendar |

Defaults (override in `.env`, see `.env.example`):

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUTH_LOGIN_MAX_FAILURES` | `5` | Failures before login lockout |
| `AUTH_LOGIN_WINDOW_MINUTES` | `15` | Sliding window |
| `AUTH_LOGIN_LOCKOUT_MINUTES` | `15` | Lock duration |
| `AUTH_LOGIN_RATE_LIMIT_MAX` | `20` | Fastify IP cap for login |
| `AUTH_REGISTER_MAX_FAILURES` | `10` | Invite probe failures |
| `AUTH_REGISTER_WINDOW_MINUTES` | `60` | |
| `AUTH_REGISTER_LOCKOUT_MINUTES` | `30` | |
| `AUTH_REGISTER_RATE_LIMIT_MAX` | `15` | Fastify IP cap for invite accept |
| `API_AUTH_MAX_FAILURES` | `40` | Bad bearer / calendar / pair attempts |
| `API_AUTH_WINDOW_MINUTES` | `15` | |
| `API_AUTH_LOCKOUT_MINUTES` | `15` | |

Responses may include `Retry-After`. Lockout state is in-memory (per process).

## Error format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "requestId": "...",
    "details": {}
  }
}
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_TOKEN`, `INVALID_REQUEST`, `RATE_LIMITED`, `FEED_DISABLED`, `SYNC_DISABLED`, `PAIRING_CODE_INVALID`, `PAIRING_CODE_EXPIRED`, `SUSPICIOUS_EMPTY_SNAPSHOT`, `SOURCE_IDENTITY_MISMATCH`, `INTERNAL_ERROR`.

---

_Document version: Seqta Link 2.1.1_
