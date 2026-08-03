# Deployment on Proxmox VE (Debian LXC)

完整分步部署教程见 **[docs/pve_deploy.md](pve_deploy.md)**（简体中文）。

## Quick reference

- Debian 13 LXC, 1 vCPU, 1 GB RAM recommended
- Node.js 24 LTS, unprivileged container, no Docker required

## Paths

```text
/opt/seqta-calendar/current     Application
/var/lib/seqta-calendar           SQLite data
/var/backups/seqta-calendar       Backups
/etc/seqta-calendar.env           Environment
```

## Deploy files

- [deploy/seqta-calendar.service](../deploy/seqta-calendar.service)
- [deploy/cloudflared-example.yml](../deploy/cloudflared-example.yml)
- [deploy/seqta-calendar-backup.timer](../deploy/seqta-calendar-backup.timer)

Service listens on `127.0.0.1:3210` only — not exposed without Cloudflare Tunnel.
