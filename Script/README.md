# SEQTA Calendar Sync (Tampermonkey)

Tampermonkey userscript that extracts your SEQTA Learn timetable and uploads a normalized snapshot to the [seqta-calendar](https://timetable.leoze.top) backend via `POST /api/v1/sync`.

Apple Calendar subscribes once to the ICS feed; each manual sync updates the same feed.

## Files

| File / directory | Purpose |
|------------------|---------|
| `seqta-calendar-sync.user.js` | Built userscript (install into Tampermonkey) |
| `src/` | Source modules (edit these, not the built file) |
| `build.mjs` | Bundles `src/` → `seqta-calendar-sync.user.js` |

After editing `src/`, rebuild:

```bash
npm run build:userscript
```

## Prerequisites

1. A running **seqta-calendar** backend with a feed provisioned:

   ```bash
   npm run cli -- create-feed \
     --name "My SEQTA Timetable" \
     --school-host "learn.example-school.edu.au" \
     --student-ref "4284" \
     --timezone "Australia/Sydney"
   ```

2. Save the **Upload Token** (`scu_…`) and **Calendar URL** (`https://…/calendar/scc_….ics`).

3. Backend `ALLOWED_ORIGINS` must include your SEQTA origin, e.g. `https://learn.example-school.edu.au`.

4. [Tampermonkey](https://www.tampermonkey.net/) (or compatible userscript manager) in your browser.

## Install

1. Open Tampermonkey → **Create a new script**.
2. Delete the template and paste the full contents of `seqta-calendar-sync.user.js`, **or** use *Utilities → Install from file* and select the file.
3. Save (`Ctrl+S` / `Cmd+S`).

### Match your school URL

Default `@match` patterns cover common SEQTA hosts:

- `https://learn.*.edu.au/*`
- `https://*.seqta.com.au/*`
- `https://learn.*/*`

If your school uses a different hostname, add a line to the script metadata, e.g.:

```javascript
// @match        https://seqta.myschool.edu.au/*
```

### Custom backend domain

If your backend is not `timetable.leoze.top`, add a `@connect` line:

```javascript
// @connect      my-calendar.example.com
```

Tampermonkey requires `@connect` for every host used with `GM_xmlhttpRequest`.

## Configure

1. Log in to **SEQTA Learn** in the same browser.
2. Open your **Timetable** page (or any page — a floating panel appears after a few seconds if the toolbar is missing).
3. Click **Calendar Settings** and fill in:

   | Field | Value |
   |-------|-------|
   | Backend URL | `https://timetable.leoze.top` (or your server) |
   | Upload token | `scu_…` from feed creation |
   | Calendar URL | Optional — `scc_….ics` link for quick access after sync |
   | Weeks to sync | Default 12 (max 17, ~119 days) |
   | Student ref override | Only if auto-detection fails; must match feed `studentRef` |

Settings are stored in Tampermonkey storage (`GM_setValue` / `GM_getValue`), not sent anywhere except your backend on sync.

## Sync

1. Click **Sync Timetable**.
2. The script fetches **one week at a time** from SEQTA and builds a `coverage` array (`complete: true/false` per week).
3. Lessons are normalized and uploaded with a fresh **Idempotency-Key** (UUID).
4. Status shows counts (inserted / updated / removed) and warns if any weeks failed (those ranges will not trigger deletions on the backend).

### Empty snapshot (holidays)

If the backend returns `SUSPICIOUS_EMPTY_SNAPSHOT` (empty lessons over more than 7 complete days), the script automatically retries once with `allowEmptySnapshot: true`.

## sourceKey rules

The backend uses `sourceKey` to match the same lesson across syncs. This script follows design doc §10.1:

```
Priority 1:  date | periodKey | sourceOccurrenceId   (calendarid or ci from SEQTA)
Priority 2:  date | periodKey | courseCode           (uppercase, no spaces)
Priority 3:  date | periodKey | normalizedTitle     (lowercase slug)
```

**Never included in sourceKey:** teacher, room, start/end time, or display title alone.

| Field | Source |
|-------|--------|
| `date` | `YYYY-MM-DD` from SEQTA |
| `periodKey` | Normalized `period` label, or `slot-HHMM` from start time |
| `sourceOccurrenceId` | SEQTA `calendarid` (e.g. `1575659` or `event:5`) or `ci` |

## SEQTA assumptions

This script is based on the SEQTA Learn internal API used by the open-source [BetterSEQTA+](https://github.com/BetterSEQTA/BetterSEQTA-Plus) project (not required to run this script).

### Primary: SEQTA JSON API

| Context | Endpoint | Body |
|---------|----------|------|
| Student login | `POST /seqta/student/login` | `{ mode, query, redirect_url }` → student `id` |
| Student timetable | `POST /seqta/student/load/timetable?` | `{ from, until, student? }` → `payload.items[]` |
| Parent timetable | `POST /seqta/parent/load/timetable` | `{ list: true }` then `{ from, until, student }` |

Expected lesson fields in `payload.items`:

- `date`, `from`, `until`, `description`, `staff`, `room`, `code`, `type`, `period`
- Stable IDs: `calendarid`, `ci`

Requests use the **browser session on the SEQTA origin** (`fetch` + `credentials: include`). Session cookies are **not** forwarded to seqta-calendar.

### Fallback: DOM scraping

If the API fails for all weeks, the script parses the **currently visible** timetable DOM:

- Container: `.timetablepage` or `.timetable`
- Days: `.day` (optional `data-date`)
- Entries: `.entry.class` / `.entry`
- Subfields: `.title`, `.staff`, `.room`, `.code`, `.period`, `.times`

DOM fallback only covers the week on screen; prefer the API path for full multi-week sync.

### Skipped lesson types

Non-class rows are excluded: `note`, `holiday`, `assembly-note` (same as BetterSEQTA calendar sync).

### UI injection

- Preferred mount point: `#toolbar` on the timetable page (alongside SEQTA date/zoom controls).
- Fallback: fixed panel top-right on any matched SEQTA page.

## Security notes

- Only the **upload token** and normalized lesson JSON are sent to your backend.
- SEQTA passwords, cookies, and raw SEQTA responses are **not** uploaded.
- Use HTTPS for both SEQTA and the backend.
- Rotate the upload token if it is ever exposed.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `Could not determine student ID` | Set **Student ref override** in settings |
| `INVALID_TOKEN` | Upload token correct and not rotated |
| `FEED_MISMATCH` | `schoolHost` / `studentRef` must match feed; you're on the correct SEQTA site |
| CORS / network error | Backend `@connect` domain; `ALLOWED_ORIGINS` includes SEQTA origin |
| `SUSPICIOUS_EMPTY_SNAPSHOT` | Should auto-retry; confirm you're in a genuine holiday period |
| Partial sync warnings | Some weeks failed — incomplete coverage prevents deletions for those dates |
| No sync button on timetable | Add `@match` for your school URL; check Tampermonkey is enabled |

## Development

Edit `seqta-calendar-sync.user.js` and reload the script in Tampermonkey. For a local backend:

```javascript
// @connect      localhost
// @connect      127.0.0.1
```

Set Backend URL to `http://127.0.0.1:3210` in settings.

## Related docs

- Project design: [`../文档.md`](../文档.md) — §9 sync API, §10.1 sourceKey, §12 coverage, §20.2 CORS / GM_xmlhttpRequest
- Backend API schema (when implemented): `src/modules/sync/sync.schemas.ts`
