# Seqta Link — HTTP API v2

**Product:** Seqta Link **v3.1.1** (Flask + SQLite)  
Base URL example: `https://timetable.example.com` or `http://127.0.0.1:3210`

This document is the **only supported API**. v1 (`/api/v1/*`, `scu_` / `dvc_` / `scc_` prefixes) was removed in v3.

---

## Tokens

| Kind     | Prefix                 | Used for                                        |
| -------- | ---------------------- | ----------------------------------------------- |
| Device   | `sl_dvc_…`             | `Authorization: Bearer` on sync/status          |
| Calendar | `sl_cal_…`             | URL path on ICS feed                            |
| Session  | cookie `seqta_session` | Portal `/app/*`, Admin `/admin/*`, JSON helpers |

Upload-only tokens are **not** supported — sync always uses a paired device token.

### Sync request headers

```http
Authorization: Bearer <device-token>
Idempotency-Key: <uuid>
Content-Type: application/json
```

---

## Health

| Method | Path            | Notes            |
| ------ | --------------- | ---------------- |
| `GET`  | `/health/live`  | Process up       |
| `GET`  | `/health/ready` | SQLite reachable |

---

## Device pairing & sync

### `POST /api/v2/device/pair`

Public. Pairing codes are created in the user portal (Devices → generate code, 10 minutes, one-time).

**Body:**

```json
{ "code": "ABCD-EFGH", "deviceName": "Chrome on MacBook" }
```

**Response:**

```json
{ "deviceToken": "sl_dvc_…" }
```

Failed attempts are lockout-protected per IP (in-process).

### `POST /api/v2/sync`

Bearer device token required.

**Body:** schema version 1 — same shape as v1 sync:

```json
{
  "schemaVersion": 1,
  "schoolHost": "learn.example.edu.au",
  "studentRef": "4284",
  "timezone": "Australia/Sydney",
  "generatedAt": "2026-08-05T01:00:00Z",
  "allowEmptySnapshot": false,
  "coverage": [
    { "from": "2026-08-04", "until": "2026-08-08", "complete": true }
  ],
  "lessons": [ … ]
}
```

- Idempotent when the same `Idempotency-Key` and payload are retried.
- Deletions only inside `complete: true` coverage ranges.
- Source identity (school + student) locks on first successful sync; mismatches → `409 SOURCE_IDENTITY_MISMATCH`.
- Empty snapshot over 7 complete days requires `allowEmptySnapshot: true`.

**Success response:**

```json
{
  "syncId": "…",
  "revision": 42,
  "changed": true,
  "result": {
    "received": 120,
    "normalized": 118,
    "duplicatesRemoved": 2,
    "inserted": 5,
    "updated": 3,
    "removed": 1,
    "restored": 0,
    "unchanged": 109
  },
  "lastSyncedAt": "2026-08-05T01:00:00Z"
}
```

### `GET /api/v2/status`

Bearer device token. No tokens or student PII in response.

```json
{
  "feed": {
    "name": "My Timetable",
    "timezone": "Australia/Sydney",
    "revision": 42
  },
  "sync": { "enabled": true, "lastSyncedAt": "…", "lastStatus": "success" },
  "events": { "active": 87 },
  "device": { "name": "Chrome on MacBook", "lastSeenAt": "…" }
}
```

---

## Calendar feed

### `GET /calendar/<token>.ics`

Token is the full `sl_cal_…` value (`.ics` suffix optional).

| Header          | Value                                           |
| --------------- | ----------------------------------------------- |
| `Content-Type`  | `text/calendar; charset=utf-8`                  |
| `Cache-Control` | `private, no-cache, max-age=0, must-revalidate` |
| `ETag`          | `"calendar-<revision>"`                         |
| `Last-Modified` | HTTP date of last feed change                   |

- Matching `If-None-Match` → `304`
- Invalid token → `404` (empty body)
- Feed disabled for user → `410` plain text
- Events: stable HMAC `UID`, `SEQUENCE` on change, `STATUS:CONFIRMED` / `CANCELLED`

---

## Portal (SSR + session)

Most user/admin actions are **server-rendered forms** with Flask `flash()` — not JSON APIs.

| Method     | Path                 | Notes                                           |
| ---------- | -------------------- | ----------------------------------------------- |
| `GET/POST` | `/app/login`         | User sign-in                                    |
| `GET/POST` | `/admin/login`       | Admin sign-in (role must be `owner` or `admin`) |
| `POST`     | `/auth/logout`       | Clears session cookie                           |
| `GET`      | `/app/dashboard`     | User dashboard                                  |
| `GET`      | `/app/timetable`     | `?from=&until=`                                 |
| `GET/POST` | `/app/calendar`      | View / rotate subscription URL                  |
| `GET/POST` | `/app/devices`       | Pairing codes + device list                     |
| `GET`      | `/app/sync-history`  | Sync run history                                |
| `GET/POST` | `/app/account`       | Preferences + password change                   |
| `GET`      | `/admin/dashboard`   | Admin stats + audit                             |
| `GET`      | `/admin/users`       | User list                                       |
| `GET/POST` | `/admin/users/:id`   | User detail, suspend, reset identity            |
| `GET/POST` | `/admin/invitations` | Create / delete invitations                     |
| `GET`      | `/admin/audit`       | Audit log                                       |

Auth is enforced **server-side** (`@login_required` / `@admin_required`). Only HTTP `401` redirects to login; `403` and `5xx` show on-page errors (not login loops).

---

## JSON helpers (optional fetch)

Thin JSON endpoints for in-page actions (Toastify on the client):

| Method   | Path                           | Auth    | Notes               |
| -------- | ------------------------------ | ------- | ------------------- |
| `POST`   | `/api/v2/me/pairing-codes`     | Session | Create pairing code |
| `DELETE` | `/api/v2/me/devices/:deviceId` | Session | Revoke device       |

Most portal actions use form POST + redirect instead (e.g. rotate calendar URL, revoke device from devices page).

---

## Invitations

| Method     | Path              | Notes                                                 |
| ---------- | ----------------- | ----------------------------------------------------- |
| `GET/POST` | `/invite?token=…` | Accept invitation (SSR form → creates user + session) |

Admin creates invitations via `/admin/invitations` form (invite URL shown in flash message).

New accounts require an invitation. Owner is created via CLI `bootstrap-owner` or `OWNER_BOOTSTRAP_*` on first boot when no owner exists.

---

## Rate limits & lockout

| Surface                           | Protection                                          |
| --------------------------------- | --------------------------------------------------- |
| `POST /app/login`, `/admin/login` | Failed-attempt lockout per IP + email → flash error |
| `POST /api/v2/device/pair`        | Failed-attempt lockout per IP                       |

Defaults (`.env`):

| Variable                     | Default |
| ---------------------------- | ------- |
| `AUTH_LOGIN_MAX_FAILURES`    | `5`     |
| `AUTH_LOGIN_WINDOW_MINUTES`  | `15`    |
| `AUTH_LOGIN_LOCKOUT_MINUTES` | `15`    |

Lockout state is **in-process** (single-instance deployment).

---

## Error format (JSON routes)

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_TOKEN`, `INVALID_REQUEST`, `FEED_DISABLED`, `SYNC_ALREADY_RUNNING`, `IDEMPOTENCY_KEY_REUSED`, `SUSPICIOUS_EMPTY_SNAPSHOT`, `SOURCE_IDENTITY_MISMATCH`, `DUPLICATE_LESSON_CONFLICT`, `DEVICE_LIMIT`, `INTERNAL_ERROR`.

---

_Document version: Seqta Link 3.1.1_
