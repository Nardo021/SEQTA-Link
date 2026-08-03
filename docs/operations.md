# Operations

## Create a feed

```bash
npm run cli -- create-feed \
  --name "Leo SEQTA Timetable" \
  --school-host "learn.example-school.edu.au" \
  --student-ref "4284"
```

Store upload and calendar tokens securely — they cannot be recovered.

## Rotate tokens

```bash
npm run cli -- rotate-token --feed <feed-id> --type upload
npm run cli -- rotate-token --feed <feed-id> --type calendar
```

Rotating the calendar token requires re-subscribing in Apple Calendar.

## Backup

```bash
npm run cli -- backup --output /var/backups/seqta-calendar
```

Uses SQLite online backup + `integrity_check` + gzip.

## Monitoring

Monitor:

- `https://timetable.leoze.top/health/live`
- `https://timetable.leoze.top/health/ready`

Do not use real calendar tokens in public monitors.

## Logs

Structured JSON via Fastify logger. Key events: `sync_completed`, `calendar_served`, `backup_completed`.

Calendar URLs are redacted as `/calendar/[REDACTED].ics`.
