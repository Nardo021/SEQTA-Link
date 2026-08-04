# Seqta Link — Proxmox VE 部署指南

在 **Proxmox VE** 的 **Debian LXC** 上部署 **Seqta Link v2.1.0**（内嵌 PostgreSQL，一条命令启动）。

**相关文档：** [docs/api.md](api.md) · [script/README.md](../script/README.md) · [.env.example](../.env.example)

> **命名说明：** 产品名为 Seqta Link（npm：`seqta-link`）。下文中的 `/opt/seqta-calendar`、`seqta-calendar.service` 等为部署路径 / 单元历史命名，可继续沿用，无需为升级强行改路径。

> **Shell 前提：** LXC 里通常已经是 **root**（`pct enter` / 控制台登录）。本文命令按 **已在 root 下** 编写，**不要再套 `sudo`**（许多容器未装 `sudo`，会直接报错）。需要以 `seqta` 用户跑 npm/cli 时，用 `runuser -u seqta -- …`。

---

## 1. 架构

```text
Internet → Cloudflare Tunnel → LXC (127.0.0.1:3210)
                                 ├── Node 应用 (systemd) — Seqta Link
                                 └── 内嵌 PostgreSQL
                                       数据目录: /var/lib/seqta-calendar/pg
```

| 路径 | 用途 |
|------|------|
| `/opt/seqta-calendar/current` | 应用代码 |
| `/var/lib/seqta-calendar/pg` | 内嵌 Postgres 数据（`EMBEDDED_PG_DATA_DIR`） |
| `/etc/seqta-calendar.env` | 环境变量 |
| `/var/backups/seqta-calendar` | `pg_dump` 备份 |

也可 `EMBEDDED_PG=false` + `DATABASE_URL` 使用外部 Postgres。

模板：`deploy/seqta-calendar.service`、`deploy/cloudflared-example.yml`、`deploy/seqta-calendar-backup.timer`。

---

## 2. LXC 与系统依赖

推荐：Debian 13、1 vCPU、1–2 GB RAM、unprivileged LXC、Node.js 24 LTS。

```bash
# 已是 root
apt update && apt install -y curl ca-certificates gnupg
# 按 NodeSource / 发行版文档安装 Node 24
node -v   # v24.x
```

创建运行用户与目录：

```bash
useradd --system --home /opt/seqta-calendar --shell /usr/sbin/nologin seqta
mkdir -p /opt/seqta-calendar /var/lib/seqta-calendar/pg /var/backups/seqta-calendar
chown -R seqta:seqta /opt/seqta-calendar /var/lib/seqta-calendar /var/backups/seqta-calendar
```

---

## 3. 部署应用

```bash
# 以部署流程将仓库放到 /opt/seqta-calendar/current
cd /opt/seqta-calendar/current
runuser -u seqta -- npm ci
# 首次需允许 embedded-postgres 对应平台包的 postinstall（如 linux-x64）
runuser -u seqta -- npm run build
```

交互式初始化（推荐，会写环境文件 + `.seqta-initialized` 标记，防误覆盖）：

```bash
cd /opt/seqta-calendar/current
runuser -u seqta -- npm run cli -- init --env /etc/seqta-calendar.env
# 按提示输入公开链接、学校域名、管理员邮箱/密码等
# 密钥可留空自动生成；保存前会总览并要求 yes/no
```

若 `init` 需写 `/etc/seqta-calendar.env` 而权限不足，可先以 root 建文件再改属主：

```bash
touch /etc/seqta-calendar.env
chown seqta:seqta /etc/seqta-calendar.env
chmod 600 /etc/seqta-calendar.env
```

也可手动从 `.env.example` 复制后编辑。生产必须设置：

- `SESSION_SECRET`（与 `TOKEN_PEPPER` 不同，至少 32 字节 base64）
- `TOKEN_PEPPER` / `UID_SECRET`（互不相同）
- `PUBLIC_BASE_URL`、`ALLOWED_ORIGINS`
- `AUTH_DEV_LOGIN=false`

然后：

```bash
runuser -u seqta -- npm run db:migrate
# init 已写 OWNER_BOOTSTRAP_* 时，首次启动会建 owner；也可：
runuser -u seqta -- npm run cli -- bootstrap-owner \
  --email you@example.com --password '…'
```

启用 systemd（见 `deploy/seqta-calendar.service`，Description 为 Seqta Link），监听 `127.0.0.1:3210`。经 Cloudflare Tunnel 对外暴露 HTTPS。

从 **v1 SQLite** 迁移时，在新库 migrate 之后使用：

```bash
runuser -u seqta -- npm run cli -- migrate-v1-sqlite \
  --db /path/to/calendar.sqlite \
  --owner-name "Leo" \
  --out /var/backups/seqta-calendar/migration-output
```

---

## 4. 日常运维

**CLI 一览：**

| 命令 | 用途 |
|------|------|
| `init` | 交互式写环境文件 |
| `bootstrap-owner` | 创建 / 提升 owner |
| `create-feed` | 运维侧创建用户 + 日历 + `scu_` 上传设备 |
| `rotate-token` | 轮换 upload / calendar token |
| `inspect-feed` | 检查日历状态 |
| `backup` | `pg_dump` |
| `migrate-v1-sqlite` | v1 SQLite → v2 |

以下均在 **root** 下执行，通过 `runuser` 降权到 `seqta`：

**创建课表（CLI，角色为普通 user，不是 owner）：**

```bash
cd /opt/seqta-calendar/current
runuser -u seqta -- npm run cli -- create-feed \
  --name "My Timetable" \
  --school-host "learn.example.edu.au" \
  --student-ref "4284"
```

**备份（需主机有 `pg_dump`）：**

```bash
cd /opt/seqta-calendar/current
runuser -u seqta -- npm run cli -- backup --output /var/backups/seqta-calendar
```

定时器见 `deploy/seqta-calendar-backup.timer`。

**健康检查：**

- `GET /health/live` → 进程存活
- `GET /health/ready` → Postgres、migrations、角色池

**账号：** 本地邮箱密码；新用户必须邀请注册（`/admin` 发邀请 → `/invite.html`）。Owner 仅通过 `bootstrap-owner`（或首次启动且同时设置 `OWNER_BOOTSTRAP_EMAIL` + `OWNER_BOOTSTRAP_PASSWORD` 且库中尚无 owner）。登录不会自动提权。

**门户：** `/app` 用户端（Dashboard / Devices 配对 / Calendar 订阅 / Sync history / Account）；`/admin` 管理端（用户管理、Sync/Feed 开关、课表查看、设备撤销、邀请、审计日志）。

**同学接入：** Portal → Devices 生成配对码 → Tampermonkey **Pair device** → Sync（`/api/v1/sync`）→ Calendar 页生成订阅 URL → [Apple](../web/help/apple.html) / [Google·Android](../web/help/google.html) 订阅说明。

---

## 5. 安全要点

- 服务只绑 loopback；公网走 Tunnel
- Token / Calendar URL 只显示一次；库内仅存 hash
- 日志脱敏 Authorization 与 calendar 路径
- 生产关闭 `AUTH_DEV_LOGIN`；生产强制 `SESSION_SECRET`
- 登录 / 邀请注册 / 设备配对 / API Token 探测有限流与失败锁定（`AUTH_LOGIN_*`、`AUTH_REGISTER_*`、`API_AUTH_*`，见 `.env.example` 与 [api.md](api.md)）
- 锁定状态在进程内存中；多实例需自行加网关限流或共享层
- 定期备份 `EMBEDDED_PG_DATA_DIR` 与 `/etc/seqta-calendar.env`（含 pepper/secrets）

---

_文档版本：Seqta Link 2.1.0 · 内嵌 / 外部 PostgreSQL · root 下部署（无 sudo）· 本地认证与防爆破_
