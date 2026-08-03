# Architecture

See [文档.md](../文档.md) §5 for the canonical architecture diagram and module layout.

```text
HTTP (Fastify)
  → Authentication / Rate limit / CORS
  → Sync Service (transaction + mutex)
  → Calendar Service (ICS serializer)
  → SQLite (feeds, events, aliases, sync_runs)
```

Key invariants:

- UID and naturalKey computed server-side
- Deletes only in `complete: true` coverage ranges
- All writes in a single `BEGIN IMMEDIATE` transaction
