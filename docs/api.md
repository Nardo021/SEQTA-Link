# Seqta Link — HTTP API (legacy)

> **Removed in v3.0.0.** Seqta Link no longer runs Node/Fastify or PostgreSQL, and `/api/v1` is not available.

Use **[docs/api-v2.md](api-v2.md)** for the current Flask + SQLite API:

| v1 (removed)                            | v3 (current)                                                 |
| --------------------------------------- | ------------------------------------------------------------ |
| `POST /api/v1/sync`                     | `POST /api/v2/sync`                                          |
| `GET /api/v1/status`                    | `GET /api/v2/status`                                         |
| `POST /api/device/pair`                 | `POST /api/v2/device/pair`                                   |
| `scu_…` / `dvc_…` upload/device tokens  | `sl_dvc_…` device token only                                 |
| `scc_…` calendar token                  | `sl_cal_…` calendar token                                    |
| JSON portal `/api/me/*`, `/api/admin/*` | Jinja SSR `/app/*`, `/admin/*` + thin `/api/v2/me/*` helpers |
| Static `web/*.html`                     | Jinja templates in `seqta_link/templates/`                   |

If you maintain an old userscript or client, upgrade to **Seqta Link v3** (`script/seqta-calendar-sync.user.js`) and [script/README.md](../script/README.md).

---

_Document version: Seqta Link 3.1.2 — legacy pointer only_
