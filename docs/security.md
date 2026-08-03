# Security

## Secrets

- `TOKEN_PEPPER` — HMAC for token storage (must differ from UID_SECRET)
- `UID_SECRET` — HMAC for stable ICS UIDs
- Both must be backed up with the database

## Token model

- Upload token: sync + status only
- Calendar token: ICS feed only (URL is the secret)
- Raw tokens never stored in SQLite

## Network

- Bind `127.0.0.1:3210`
- Public access via Cloudflare Tunnel (TLS at edge)
- CORS: explicit origins only, no `*`

## Rate limits

- Sync: 10 / 10 min / upload token
- Status: 60 / min / upload token
- Calendar: 120 / min / IP

## Logging redaction

Never log: Authorization header, raw tokens, full calendar URLs, request bodies, teacher/room lists.

## Data not collected

No SEQTA credentials, cookies, sessions, or raw SEQTA responses are stored.
