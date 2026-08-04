# SEQTA Link

[English](README.md) | [中文](README.zh-CN.md)

**自托管 SEQTA 课表同步 → Apple 日历（ICS）**

用 Tampermonkey 脚本从 SEQTA Learn 提取课表，同步到轻量 Fastify 后端，在 Apple 日历中订阅一次即可。之后每次手动同步都会更新同一 Feed——无需重新订阅，服务端也不接触 SEQTA 账号密码。

[![License: AGPL-3.0 + NC](https://img.shields.io/badge/license-AGPL--3.0%20%2B%20NC-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](package.json)
[![Fastify](https://img.shields.io/badge/Fastify-5-black.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-44%20passing-success.svg)](test/)

|                         |                           |
| ----------------------- | ------------------------- |
| **44** 项自动化测试     | **45** 个 TypeScript 模块 |
| **SQLite** 单文件数据库 | **RFC 5545** ICS Feed     |
| **Tampermonkey** 抓取   | **Node 24+** 运行时       |

```text
SEQTA Learn
    │  Tampermonkey（手动同步）
    ▼
POST /api/v1/sync  ──►  标准化 · 去重 · 事务写入
    │
    ▼
SQLite
    │
    ▼
GET /calendar/<token>.ics  ──►  Apple 日历（订阅一次）
```

---

## 为什么需要 SEQTA Link

| 痛点                     | 本项目的处理方式                     |
| ------------------------ | ------------------------------------ |
| 反复同步产生重复日历事件 | 服务端稳定 `UID` + natural key       |
| 已取消课程仍留在日历里   | 仅在 `complete: true` 覆盖范围内删除 |
| 某周抓取失败误删旧数据   | 不完整覆盖不会触发删除               |
| 第三方服务器保存账号凭据 | 后端从不接收 SEQTA 密码或 Cookie     |
| 日历 URL 可被猜测        | 不透明 Feed Token（`scc_…`）         |

---

## 功能特性

- **脚本抓取** — 在浏览器内读取 SEQTA 课表，点击 Sync 即可上传
- **幂等同步** — `Idempotency-Key` + `BEGIN IMMEDIATE` 事务写入
- **稳定 ICS** — RFC 5545 Feed，支持 ETag / `304 Not Modified`
- **Token 安全** — 上传令牌（`scu_…`）与日历令牌（`scc_…`）分离，加 pepper 哈希存储
- **运维就绪** — CLI 支持创建 / 轮换 / 检查 / 备份；提供 PVE 与 Cloudflare Tunnel 模板
- **测试覆盖** — 单元、集成与 ICS golden fixture

---

## 快速开始

**环境要求：** Node.js 24+、npm、[Tampermonkey](https://www.tampermonkey.net/)

```bash
cp .env.example .env          # 填写 TOKEN_PEPPER、UID_SECRET、ALLOWED_ORIGINS 等
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

1. 将 **Upload Token**（`scu_…`）填入 userscript 设置。
2. 在 Tampermonkey 中安装 `Script/seqta-calendar-sync.user.js`（详见 [Script/README.md](Script/README.md)）。
3. 打开 SEQTA → 点击 **Sync Timetable**。
4. 在 Apple 日历中订阅 **Calendar URL**（`…/calendar/scc_….ics`）。

```bash
npm test                      # 44 项测试
npm run build:userscript      # 从 Script/src/ 重新构建 userscript
```

---

## 仓库结构

| 路径      | 说明                                     |
| --------- | ---------------------------------------- |
| `src/`    | Fastify 5 + SQLite 后端                  |
| `Script/` | Tampermonkey 同步脚本（源码 + 构建产物） |
| `docs/`   | API、部署、安全、运维文档                |
| `deploy/` | systemd 与 Cloudflare Tunnel 模板        |
| `test/`   | 单元 / 集成 / golden 测试                |

---

## 文档

- [docs/api.md](docs/api.md) — HTTP API
- [docs/architecture.md](docs/architecture.md) — 模块布局与不变量
- [docs/pve_deploy.md](docs/pve_deploy.md) — Proxmox LXC 部署教程
- [docs/security.md](docs/security.md) — Token、Origins 与加固
- [docs/operations.md](docs/operations.md) — 备份与运维说明
- [Script/README.md](Script/README.md) — 脚本安装与 `sourceKey` 规则
- [文档.md](文档.md) — 完整设计规格（中文）

---

## 许可证

本项目采用 **GNU Affero General Public License v3.0**，并附加 **非商业使用条款**。

- **二次开发必须开源：** 你分发或通过网络提供的修改版本，必须按相同条款（AGPL-3.0 + 本附加条款）公开完整对应源码。
- **仅限非商业使用：** 未经版权方另行书面许可，不得将本软件用于商业用途（包括有偿托管或出售衍生作品）。

完整文本见 [LICENSE](LICENSE)。
