# seqta-calendar

自托管 SEQTA 课表同步：Tampermonkey 脚本抓取课表 → 后端去重/增量写入 SQLite → Apple Calendar 订阅 ICS Feed。

完整设计见 [文档.md](文档.md)。

## 仓库结构

| 路径 | 说明 |
|------|------|
| `src/` | Fastify 5 + SQLite 后端 |
| `Script/` | Tampermonkey 同步脚本（见 [Script/README.md](Script/README.md)） |
| `docs/` | API、部署、运维摘要 |
| `deploy/` | systemd 与 Cloudflare Tunnel 模板 |
| `test/` | 单元 / 集成 / golden 测试 |

## 快速开始（本地）

```bash
cp .env.example .env   # 填写 TOKEN_PEPPER、UID_SECRET 等
npm ci
npm run build
npm run db:migrate
npm run cli -- create-feed --name "My Timetable" \
  --school-host "learn.example-school.edu.au" \
  --student-ref "4284" --timezone "Australia/Sydney"
npm run dev
npm test   # 38 项测试，需 Node 24+（生产建议 24 LTS）
```

将输出的 Upload Token 配置到 Tampermonkey 脚本（`Script/seqta-calendar-sync.user.js`），在 SEQTA 课表页点击 **Sync Timetable**。

## 文档

- [docs/api.md](docs/api.md) — HTTP API
- [docs/pve_deploy.md](docs/pve_deploy.md) — PVE LXC 完整部署教程
- [docs/deployment-pve.md](docs/deployment-pve.md) — 部署快速索引
- [Script/README.md](Script/README.md) — 脚本安装与 sourceKey 规则
