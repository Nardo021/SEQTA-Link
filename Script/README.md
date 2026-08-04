# Seqta Link Sync (Tampermonkey)

**Userscript v2.1.0** for [Seqta Link](../README.md) — extracts your SEQTA Learn timetable and uploads it to the backend.

**Recommended path:** Portal pairing code → Device Token (`dvc_…`) → `POST /api/v1/sync` / `GET /api/v1/status`.

Legacy admin-provisioned upload tokens (`scu_…`) still work via Settings.

> **Note (v2.1):** There is no `/api/device/sync` or `/api/device/status`. After pairing, the script talks only to `/api/v1/*`.

## Files

| File / directory              | Purpose                                         |
| ----------------------------- | ----------------------------------------------- |
| `seqta-calendar-sync.user.js` | Built userscript (install into Tampermonkey)    |
| `src/`                        | Source modules (edit these, not the built file) |
| `userscript.header.js`        | `@name` / `@version` metadata (Seqta Link Sync) |
| `build.mjs`                   | Bundles `src/` → `seqta-calendar-sync.user.js`  |

```bash
npm run build:userscript
```

Built header should show `@name Seqta Link Sync` and `@version 2.1.0`.

## Pairing flow (recommended)

1. Sign in to the user portal (`/app`) and open **Devices**.
2. Click **Generate pairing code** (valid 10 minutes, one-time).
3. On SEQTA, click **Pair device** in the userscript panel.
4. Enter the code and a device name → script stores a `dvc_…` profile.
5. Click **Sync Timetable** (script checks `/api/v1/status` first).
6. In Portal → **Calendar**, generate/rotate the subscription URL and add it to Apple/Google Calendar ([help](../web/help/apple.html)).

Multiple profiles can be stored locally; Sync asks you to confirm the current SEQTA student vs destination account.

## Prerequisites

1. Running Seqta Link **v2.1.0+** with an account (invite or owner bootstrap).
2. Backend `ALLOWED_ORIGINS` includes your SEQTA origin.
3. [Tampermonkey](https://www.tampermonkey.net/).

## Install

1. Tampermonkey → **Create a new script** (or Install from file).
2. Paste / select `seqta-calendar-sync.user.js`.
3. Save.

### Match your school URL

Default `@match` patterns cover common SEQTA hosts. Add your school if needed:

```javascript
// @match        https://seqta.myschool.edu.au/*
```

### Custom backend domain

```javascript
// @connect      my-calendar.example.com
```

## Configure (Settings)

| Field                | Value                                                      |
| -------------------- | ---------------------------------------------------------- |
| Backend URL          | `https://timetable.leoze.top` (or your Seqta Link server)  |
| Active profile       | Switch between paired accounts                             |
| Legacy upload token  | Optional `scu_…` for CLI-provisioned feeds                 |
| Calendar URL         | Optional shortcut link after sync                          |
| Weeks to sync        | Default 12 (max 17)                                        |
| Student ref override | Only if auto-detection fails                               |

## Sync

1. Click **Sync Timetable**.
2. Confirm student → destination account.
3. Script fetches week-by-week, uploads with a fresh Idempotency-Key.
4. Incomplete weeks never trigger deletions on the backend.

Empty holiday snapshots that trigger `SUSPICIOUS_EMPTY_SNAPSHOT` auto-retry once with `allowEmptySnapshot: true`.

## sourceKey rules

```
Priority 1:  date | periodKey | sourceOccurrenceId
Priority 2:  date | periodKey | courseCode
Priority 3:  date | periodKey | normalizedTitle
```

Never include teacher, room, or start/end time in `sourceKey`.

## Security notes

- Only device/upload token + normalized lesson JSON go to your backend.
- SEQTA passwords/cookies are never uploaded.
- Use HTTPS. Rotate/revoke devices from Portal if a token leaks.
- Repeated bad tokens may return `429 RATE_LIMITED`.

## Troubleshooting

| Symptom                          | Check                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Pairing failed                   | Code unused, unexpired, sync enabled, under device limit                      |
| `INVALID_TOKEN`                  | Re-pair or fix legacy `scu_` token                                            |
| `RATE_LIMITED` / HTTP 429        | Wait for `Retry-After` / fix token                                            |
| `SOURCE_IDENTITY_MISMATCH`       | Wrong SEQTA student for this profile                                          |
| `FEED_MISMATCH`                  | schoolHost / studentRef must match calendar binding                           |
| CORS / network error             | `@connect` + `ALLOWED_ORIGINS`                                                |
| No sync button                   | `@match` + Tampermonkey enabled                                               |

## Development

```bash
npm run build:userscript
```

Local backend:

```javascript
// @connect      localhost
// @connect      127.0.0.1
```

Backend URL: `http://127.0.0.1:3210`.

## Related docs

- [README.md](../README.md) — Seqta Link overview
- [docs/api.md](../docs/api.md) — Device API, Portal API, rate limits
- [docs/pve_deploy.md](../docs/pve_deploy.md) — production deploy
