# API Summary

Full specification: [文档.md](../文档.md)

## Authentication

| Endpoint | Token |
|----------|-------|
| `POST /api/v1/sync` | Upload (`scu_...`) |
| `GET /api/v1/status` | Upload (`scu_...`) |
| `GET /calendar/:token.ics` | Calendar (`scc_...`) in URL |

Headers for sync:

```http
Authorization: Bearer <upload-token>
Idempotency-Key: <uuid>
Content-Type: application/json
```

## POST /api/v1/sync

Accepts schema version 1 snapshot with `coverage` and `lessons`. Returns counts and feed revision.

Idempotent replay when the same `Idempotency-Key` and payload are retried.

## GET /api/v1/status

Returns feed name, timezone, revision, sync timestamps, and event counts. Never returns tokens or student PII.

## GET /calendar/:token.ics

Returns RFC 5545 calendar. Supports `If-None-Match` → `304`. Invalid token → `404` (no leak).

## Error format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "requestId": "..."
  }
}
```

See §21 in [文档.md](../文档.md) for error codes.
