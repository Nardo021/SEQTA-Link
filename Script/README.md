# Seqta Link (Tampermonkey)

**Userscript v3.3.0** for [Seqta Link](../README.md) — extracts your SEQTA Learn timetable and uploads it to the backend.

**Path:** Portal pairing code → Device Token (`sl_dvc_…`) → `POST /api/v2/sync` / `GET /api/v2/status`.

> **v3 breaking change:** `/api/v1/*` and legacy tokens (`scu_`, `dvc_`, `scc_`) are **not supported**. Re-pair after upgrading the server.

## Files

| File / directory              | Purpose                                         |
| ----------------------------- | ----------------------------------------------- |
| `seqta-calendar-sync.user.js` | Built userscript (install into Tampermonkey)    |
| `src/`                        | Source modules (edit these, not the built file) |
| `userscript.header.js`        | `@name` / `@version` metadata                   |
| `build.mjs`                   | Bundles `src/` → `seqta-calendar-sync.user.js`  |

```bash
npm run build:userscript
```

## Pairing flow

1. Sign in to the user portal (`/app/login`) and open **Devices**.
2. Click **Generate pairing code** (valid 10 minutes, one-time).
3. On SEQTA, click **Pair device** in the userscript panel.
4. Enter the code and a device name → script stores an `sl_dvc_…` profile.
5. Click **Sync Timetable** (script calls `/api/v2/status` first when token prefix matches).
6. In Portal → **Calendar**, rotate the subscription URL and add `…/calendar/sl_cal_….ics` to Apple/Google Calendar.

Multiple profiles can be stored locally; Sync asks you to confirm the current SEQTA student vs destination account.

## Prerequisites

1. Running Seqta Link **v3.3.0+** with an account (invite or owner bootstrap).
2. [Tampermonkey](https://www.tampermonkey.net/).

## Install

1. Tampermonkey → **Create a new script** (or Install from file).
2. Paste / select `seqta-calendar-sync.user.js`.
3. Save.

### Update an installed script

Browser sync changes are not active until this file replaces the copy in Tampermonkey. Deploying the Worker does not update the script.

1. Rebuild with `npm run build:userscript` if you are editing source.
2. Tampermonkey → Dashboard → SEQTA Link → edit, replace the script with `seqta-calendar-sync.user.js`, and save.
3. Keep the existing `@namespace`. Paired profiles, custom backend URLs, and device tokens stay in Tampermonkey storage.
4. Confirm Settings still shows the same backend and profile, then run one manual sync.

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

| Field                | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| Backend URL          | Your Seqta Link server (e.g. `https://timetable.example.com`) |
| Active profile       | Switch between paired accounts                                |
| Calendar URL         | Optional shortcut link after sync                             |
| Weeks to sync        | Default 12 (max 17)                                           |
| Student ref override | Only if auto-detection fails                                  |

Device pairing replaces manual token entry — there is no upload-token field in v3.

## Sync

1. Click **Sync Timetable**.
2. Confirm student → destination account.
3. Script fetches week-by-week, uploads to `/api/v2/sync` with a fresh `Idempotency-Key`.
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

- Only device token + normalized lesson JSON go to your backend.
- SEQTA passwords/cookies are never uploaded.
- Use HTTPS. Revoke devices from Portal if a token leaks.
- Repeated bad pairing attempts may be temporarily blocked.

## Troubleshooting

| Symptom                       | Check                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Pairing failed                | Code unused, unexpired, sync enabled, under device limit                             |
| `INVALID_TOKEN`               | Re-pair (old `dvc_`/`scu_` tokens invalid on v3)                                     |
| `SOURCE_IDENTITY_MISMATCH`    | Wrong SEQTA student for this profile                                                 |
| CORS / network error          | `@connect` includes your backend host                                                |
| No sync button                | `@match` + Tampermonkey enabled on SEQTA page                                        |
| Login works but portal errors | Server-side issue — check flash message or HTTP status (not a cookie loop on v3 SSR) |

## Development

```bash
npm run build:userscript
```

Local backend:

```javascript
// @connect      localhost
// @connect      127.0.0.1
```

Backend URL in settings: `http://127.0.0.1:3210`.

Start server:

```bash
pip install -e ".[dev]"
python run.py
```

## Related docs

- [README.md](../README.md) — Seqta Link overview
- [docs/api-v2.md](../docs/api-v2.md) — Device API, portal routes, errors
- [docs/pve_deploy.md](../docs/pve_deploy.md) — production deploy

## Smart Auto Sync

Opt in under Calendar Settings for each paired profile, school host and backend. First complete one confirmed manual sync. Every 15 minutes, while the SEQTA tab is visible and authenticated, the script also checks on return to the tab and after the network recovers. Simultaneous triggers collapse into one check. A failed check waits 15 minutes; it does not add another 15 minutes on top. Network and temporary server failures retry up to three times for the same upload, keeping the original idempotency key and payload. Rate limits follow Retry-After, waiting at most 60 seconds inside the check. Identity mismatch, an invalid device token, and an expired SEQTA session stop automatic checks until you save settings, pair again, or run a manual sync. Unchanged snapshots are successful checks, not failures. Incomplete or empty automatic snapshots are not uploaded, so existing lessons stay. Closing the browser stops auto sync. The Worker can record the last attempt separately from the last successful source check. That server change is not live until its migration is applied and the Worker is deployed. Staging Access can prevent machine requests.
