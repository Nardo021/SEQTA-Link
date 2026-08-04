# SEQTA Link

[English](README.md) | [中文](README.zh-CN.md)

**Self-hosted SEQTA timetable sync → Apple Calendar (ICS)**

Extract lessons from SEQTA Learn with a Tampermonkey userscript, sync them to a small Fastify backend, and subscribe once in Apple Calendar. Every manual sync updates the same feed — no re-subscribe, no SEQTA credentials on the server.

[![License: AGPL-3.0 + NC](https://img.shields.io/badge/license-AGPL--3.0%20%2B%20NC-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](package.json)
[![Fastify](https://img.shields.io/badge/Fastify-5-black.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-44%20passing-success.svg)](test/)

|                           |                           |
| ------------------------- | ------------------------- |
| **44** automated tests    | **45** TypeScript modules |
| **SQLite** single-file DB | **RFC 5545** ICS feed     |
| **Tampermonkey** capture  | **Node 24+** runtime      |

```text
SEQTA Learn
    │  Tampermonkey (manual sync)
    ▼
POST /api/v1/sync  ──►  normalize · dedupe · transactional write
    │
    ▼
SQLite
    │
    ▼
GET /calendar/<token>.ics  ──►  Apple Calendar (subscribe once)
```

---

## Why SEQTA Link

| Problem                                 | How this project handles it                   |
| --------------------------------------- | --------------------------------------------- |
| Duplicate calendar events after re-sync | Server-side stable `UID` + natural keys       |
| Cancelled lessons sticking around       | Deletes only inside `complete: true` coverage |
| Partial week failures wiping data       | Incomplete coverage never triggers deletes    |
| Credentials on a third-party server     | Backend never sees SEQTA passwords or cookies |
| Guessable calendar URLs                 | Opaque feed tokens (`scc_…`)                  |

---

## Features

- **Userscript capture** — reads the SEQTA timetable in-browser; you click Sync
- **Idempotent sync** — `Idempotency-Key` + transactional `BEGIN IMMEDIATE` writes
- **Stable ICS** — RFC 5545 feed with ETag / `304 Not Modified`
- **Token security** — separate upload (`scu_…`) and calendar (`scc_…`) tokens, peppered hashes
- **Ops-ready** — CLI for feed create / rotate / inspect / backup; PVE + Cloudflare Tunnel templates
- **Tested core** — unit, integration, and golden ICS fixtures

---

## Quick start

**Requirements:** Node.js 24+, npm, [Tampermonkey](https://www.tampermonkey.net/)

```bash
cp .env.example .env          # set TOKEN_PEPPER, UID_SECRET, ALLOWED_ORIGINS, …
npm ci
npm run build
npm run db:migrate

npm run cli -- create-feed \
  --name "My Timetable" \
  --school-host "learn.example-school.edu.au" \
  --student-ref "4284" \
  --timezone "Australia/Sydney"

npm run dev
```

1. Copy the **Upload Token** (`scu_…`) into the userscript settings.
2. Install `Script/seqta-calendar-sync.user.js` in Tampermonkey (see [Script/README.md](Script/README.md)).
3. Open SEQTA → click **Sync Timetable**.
4. Subscribe Apple Calendar to the **Calendar URL** (`…/calendar/scc_….ics`).

```bash
npm test                      # 44 tests
npm run build:userscript      # rebuild Script/seqta-calendar-sync.user.js from Script/src/
```

---

## Repository layout

| Path      | Role                                          |
| --------- | --------------------------------------------- |
| `src/`    | Fastify 5 + SQLite backend                    |
| `Script/` | Tampermonkey userscript (source + built file) |
| `docs/`   | API, deploy, security, operations             |
| `deploy/` | systemd & Cloudflare Tunnel templates         |
| `test/`   | Unit, integration, and golden tests           |

---

## Documentation

- [docs/api.md](docs/api.md) — HTTP API
- [docs/architecture.md](docs/architecture.md) — module layout & invariants
- [docs/pve_deploy.md](docs/pve_deploy.md) — Proxmox LXC deploy guide
- [docs/security.md](docs/security.md) — tokens, origins, hardening
- [docs/operations.md](docs/operations.md) — backup & ops notes
- [Script/README.md](Script/README.md) — userscript install & `sourceKey` rules
- [文档.md](文档.md) — full design spec (Chinese)

---

## License

This project is licensed under the **GNU Affero General Public License v3.0**, with **additional non-commercial terms**.

- **Open source required:** modifications you distribute or offer as a network service must publish complete corresponding source under the same terms (AGPL-3.0 + these additional terms).
- **Non-commercial only:** commercial use (including paid hosting or selling derivatives) is not allowed without a separate written license.

See [LICENSE](LICENSE) for the full text.
