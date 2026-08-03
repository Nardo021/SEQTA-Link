# Troubleshooting

## Service won't start

- Check `/etc/seqta-calendar.env` has valid base64 `TOKEN_PEPPER` and `UID_SECRET` (32+ bytes each, different values)
- Run `npm run db:migrate` manually
- Check `/health/ready` response for failing checks

## 401 on sync

- Verify upload token prefix `scu_`
- Token may have been rotated — use CLI to rotate again if lost

## 409 SYNC_ALREADY_RUNNING

- Another sync is in progress for the same feed
- Retry after a few seconds

## 409 DUPLICATE_LESSON_CONFLICT

- Two lessons in one payload map to the same slot with different data
- Fix sourceKey / snapshot in `Script/seqta-calendar-sync.user.js`

## 422 SUSPICIOUS_EMPTY_SNAPSHOT

- Empty snapshot with >7 days complete coverage
- Send `allowEmptySnapshot: true` during holidays

## Calendar not updating

- Apple Calendar refreshes on its schedule (REFRESH-INTERVAL: PT1H)
- Verify sync succeeded via `/api/v1/status`
- Check ETag changes on `GET /calendar/...ics`

## 404 on calendar URL

- Calendar token invalid or rotated
- Re-copy URL from `create-feed` or `rotate-token`

## SQLite issues

- Ensure single process (no cluster)
- Do not store DB on NFS/SMB
- Use `npm run cli -- backup` instead of copying WAL files directly
