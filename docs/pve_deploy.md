# seqta-calendar — Proxmox VE 部署指南

本文档是在 **Proxmox VE** 上通过 **Debian LXC** 部署 `seqta-calendar` 的完整分步教程。部署完成后，Tampermonkey 脚本可将 SEQTA 课表同步到后端，Apple Calendar 通过 ICS Feed 长期订阅。

**公开域名示例：** `timetable.leoze.top`（请替换为你自己的域名）

**相关文档：**

- [文档.md](../文档.md) — 系统设计全文
- [docs/api.md](api.md) — HTTP API
- [docs/operations.md](operations.md) — 日常运维
- [docs/security.md](security.md) — 安全摘要
- [Script/README.md](../Script/README.md) — Tampermonkey 脚本配置

---

## 目录

1. [架构概览](#1-架构概览)
2. [前置条件](#2-前置条件)
3. [创建 LXC 容器](#3-创建-lxc-容器)
4. [LXC 基础配置](#4-lxc-基础配置)
5. [安装 Node.js 24](#5-安装-nodejs-24)
6. [创建用户与目录](#6-创建用户与目录)
7. [部署应用代码](#7-部署应用代码)
8. [配置环境变量](#8-配置环境变量)
9. [构建与数据库迁移](#9-构建与数据库迁移)
10. [创建第一个 Feed](#10-创建第一个-feed)
11. [安装 systemd 服务](#11-安装-systemd-服务)
12. [配置 Cloudflare Tunnel](#12-配置-cloudflare-tunnel)
13. [健康检查验证](#13-健康检查验证)
14. [首次同步测试](#14-首次同步测试)
15. [Apple Calendar 订阅](#15-apple-calendar-订阅)
16. [配置自动备份](#16-配置自动备份)
17. [监控（Uptime Kuma）](#17-监控uptime-kuma)
18. [数据库恢复](#18-数据库恢复)
19. [注意事项](#19-注意事项)

---

## 1. 架构概览

```text
SEQTA Learn（浏览器 + Tampermonkey）
    │ POST /api/v1/sync（Bearer Upload Token）
    ▼
Cloudflare Edge（TLS 终止）
    │ Cloudflare Tunnel（出站连接，无需开放入站端口）
    ▼
LXC 内 Fastify 后端（127.0.0.1:3210）
    │
    ▼
SQLite（/var/lib/seqta-calendar/calendar.sqlite）
    │
    ▼
GET /calendar/<token>.ics → Apple Calendar 订阅
```

后端**只监听 localhost**，公网访问完全依赖 Cloudflare Tunnel，PVE/LXC 无需向公网开放任何入站端口。

---

## 2. 前置条件

| 项目 | 要求 |
|------|------|
| Proxmox VE | 已安装并可创建 LXC |
| Cloudflare 账号 | 已添加目标域名，可创建 Tunnel |
| 本地机器 | 能 SSH 到 LXC，能 git clone 或 scp 上传代码 |
| SEQTA 学校域名 | 用于 `ALLOWED_ORIGINS` 和 Feed 配置 |

**标准路径（全文统一使用）：**

```text
/opt/seqta-calendar/current     应用代码（WorkingDirectory）
/var/lib/seqta-calendar         SQLite 数据目录
/var/backups/seqta-calendar     本地备份输出目录
/etc/seqta-calendar.env         环境变量（含密钥）
```

---

## 3. 创建 LXC 容器

在 Proxmox Web UI 或通过 CLI 创建 **非特权（Unprivileged）** LXC 容器。

### 3.1 推荐规格

| 项目 | 值 |
|------|-----|
| 模板 | Debian 13 (Trixie) |
| vCPU | 1 |
| 内存 | 512 MB 最低，**推荐 1 GB** |
| 磁盘 | 4–8 GB |
| 网络 | 静态 LAN IP |
| 非特权容器 | 是 |
| Docker / Nesting / Keyctl | **不需要** |

### 3.2 通过 Proxmox CLI 创建（示例）

在 PVE 宿主机上执行（按你的存储池、模板 ID 和网络桥接修改）：

```bash
pct create 120 local:vztmpl/debian-13-standard_*.tar.zst \
  --hostname seqta-calendar \
  --memory 1024 \
  --cores 1 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.1.120/24,gw=192.168.1.1 \
  --unprivileged 1 \
  --features nesting=0 \
  --onboot 1

pct start 120
```

### 3.3 进入容器

```bash
pct enter 120
# 或从其他机器 SSH
ssh root@192.168.1.120
```

---

## 4. LXC 基础配置

在 LXC 内以 root 执行：

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates git rsync
timedatectl set-timezone Australia/Sydney
```

确认 DNS 与出站网络正常：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | head -1
```

---

## 5. 安装 Node.js 24

项目要求 **Node.js ≥ 24**（见 `package.json` 的 `engines` 字段）。

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node --version   # 应显示 v24.x.x
npm --version
```

---

## 6. 创建用户与目录

创建专用系统用户，并建立数据与备份目录：

```bash
useradd --system --home-dir /opt/seqta-calendar --shell /usr/sbin/nologin seqta-calendar

mkdir -p /opt/seqta-calendar/current
mkdir -p /var/lib/seqta-calendar
mkdir -p /var/backups/seqta-calendar

chown seqta-calendar:seqta-calendar /opt/seqta-calendar
chown seqta-calendar:seqta-calendar /var/lib/seqta-calendar
chown seqta-calendar:seqta-calendar /var/backups/seqta-calendar
chmod 750 /var/lib/seqta-calendar
chmod 750 /var/backups/seqta-calendar
```

**权限约定：**

| 路径 | 所有者 | 权限 |
|------|--------|------|
| `/etc/seqta-calendar.env` | `root:seqta-calendar` | `0640` |
| `/var/lib/seqta-calendar` | `seqta-calendar:seqta-calendar` | `0750` |
| `/var/backups/seqta-calendar` | `seqta-calendar:seqta-calendar` | `0750` |
| `/opt/seqta-calendar/current` | `seqta-calendar:seqta-calendar` | `0755` |

---

## 7. 部署应用代码

任选一种方式将代码放到 `/opt/seqta-calendar/current`。

### 方式 A：Git clone（推荐）

```bash
# 以 root 临时 clone，再移交所有权
git clone https://github.com/YOUR_USER/SEQTA_Link.git /tmp/seqta-calendar-src
rsync -a --delete /tmp/seqta-calendar-src/ /opt/seqta-calendar/current/ \
  --exclude node_modules --exclude .git
chown -R seqta-calendar:seqta-calendar /opt/seqta-calendar/current
rm -rf /tmp/seqta-calendar-src
```

### 方式 B：从本机 scp 上传

在开发机上：

```bash
rsync -avz --exclude node_modules --exclude .git \
  ./SEQTA_Link/ root@192.168.1.120:/opt/seqta-calendar/current/
```

在 LXC 内：

```bash
chown -R seqta-calendar:seqta-calendar /opt/seqta-calendar/current
```

### 安装依赖

```bash
cd /opt/seqta-calendar/current
sudo -u seqta-calendar npm ci
```

---

## 8. 配置环境变量

从仓库模板创建生产环境文件：

```bash
cp /opt/seqta-calendar/current/.env.example /etc/seqta-calendar.env
chmod 640 /etc/seqta-calendar.env
chown root:seqta-calendar /etc/seqta-calendar.env
```

### 8.1 生成密钥

`TOKEN_PEPPER` 与 `UID_SECRET` **必须分别生成，不能使用同一个值**：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

将两次输出分别填入 `/etc/seqta-calendar.env`。

### 8.2 编辑环境文件

```bash
nano /etc/seqta-calendar.env
```

参考配置（按实际情况修改）：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3210

DATABASE_PATH=/var/lib/seqta-calendar/calendar.sqlite

DEFAULT_TIMEZONE=Australia/Sydney
PUBLIC_BASE_URL=https://timetable.leoze.top

TOKEN_PEPPER=<第一次生成的 base64 密钥>
UID_SECRET=<第二次生成的 base64 密钥>

ALLOWED_ORIGINS=https://learn.example-school.edu.au

MAX_BODY_BYTES=2097152
MAX_LESSONS_PER_SYNC=2000
MAX_SYNC_RANGE_DAYS=120

CANCELLED_FEED_RETENTION_DAYS=14
DELETED_DATABASE_RETENTION_DAYS=90

LOG_LEVEL=info
TRUST_PROXY=true
```

**关键说明：**

- `HOST=127.0.0.1` — 后端只绑定 localhost，不直接暴露到 LAN/公网
- `PUBLIC_BASE_URL` — 必须与 Cloudflare Tunnel 的公开 hostname 一致（含 `https://`）
- `ALLOWED_ORIGINS` — 必须包含你学校的 SEQTA 页面 Origin（Tampermonkey CORS 校验）
- `TOKEN_PEPPER` / `UID_SECRET` — **必须与数据库一起备份**（见 [§19](#19-注意事项)）

---

## 9. 构建与数据库迁移

```bash
cd /opt/seqta-calendar/current

# 加载环境变量后构建
sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; npm run build'

# 运行数据库迁移
sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; npm run db:migrate'
```

迁移成功后，应出现 `/var/lib/seqta-calendar/calendar.sqlite`（及可能的 WAL 文件）。

验证文件权限：

```bash
ls -la /var/lib/seqta-calendar/
# 所有者应为 seqta-calendar:seqta-calendar
```

---

## 10. 创建第一个 Feed

Feed 代表一名学生的一份课表。以下命令**只显示一次** Upload Token 和 Calendar URL，之后无法从数据库恢复，只能轮换。

```bash
cd /opt/seqta-calendar/current

sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; \
  npm run cli -- create-feed \
    --name "Leo SEQTA Timetable" \
    --school-host "learn.example-school.edu.au" \
    --student-ref "4284" \
    --timezone "Australia/Sydney"'
```

**立即保存输出：**

```text
Feed ID:        <uuid>
Upload Token:   scu_<43 字符>
Calendar URL:   https://timetable.leoze.top/calendar/scc_<43 字符>.ics
```

建议将 Token 存入密码管理器，**不要**提交到 Git 或发送到聊天工具。

---

## 11. 安装 systemd 服务

复制仓库中的 unit 文件并启用：

```bash
cp /opt/seqta-calendar/current/deploy/seqta-calendar.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable seqta-calendar
systemctl start seqta-calendar
systemctl status seqta-calendar
```

服务定义（见 [deploy/seqta-calendar.service](../deploy/seqta-calendar.service)）要点：

- 以 `seqta-calendar` 用户运行
- `WorkingDirectory=/opt/seqta-calendar/current`
- `EnvironmentFile=/etc/seqta-calendar.env`
- `ExecStart=/usr/bin/node dist/main.js`
- 沙箱：`ProtectSystem=strict`、`ReadWritePaths=/var/lib/seqta-calendar`

查看日志：

```bash
journalctl -u seqta-calendar -f
```

---

## 12. 配置 Cloudflare Tunnel

### 12.1 安装 cloudflared

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  > /etc/apt/sources.list.d/cloudflared.list
apt update && apt install -y cloudflared
```

### 12.2 创建 Tunnel

在 [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) → **Networks → Tunnels** 创建 Tunnel，按提示在 LXC 内登录：

```bash
cloudflared tunnel login
cloudflared tunnel create seqta-calendar
```

记录输出的 **Tunnel ID** 和 credentials 文件路径。

### 12.3 编写配置文件

参考 [deploy/cloudflared-example.yml](../deploy/cloudflared-example.yml)：

```bash
mkdir -p /etc/cloudflared
nano /etc/cloudflared/config.yml
```

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: timetable.leoze.top
    service: http://127.0.0.1:3210
  - service: http_status:404
```

在 Cloudflare DNS 中为 `timetable.leoze.top` 添加 Tunnel 路由（Dashboard 通常可自动完成）。

### 12.4 安装并启动 cloudflared 服务

```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
systemctl status cloudflared
```

### 12.5 Cloudflare Cache Rule（重要）

在 Cloudflare Dashboard → **Caching → Cache Rules** 为 `/calendar/*` 添加规则：

```text
Cache eligibility: Bypass cache
```

`/calendar/*` 响应已带 `Cache-Control: private, max-age=0, must-revalidate`，但显式 Bypass 可避免边缘缓存 stale 课表。

### 12.6 不要将日历路径置于 Cloudflare Access 之后

**整个** `timetable.leoze.top` hostname **不能**放在 Cloudflare Access 后面 — Apple Calendar 无法完成交互式登录。

若未来增加管理页面，可单独对 `/admin/*` 启用 Access，而 `/calendar/*` 保持公开 Token 访问。

---

## 13. 健康检查验证

### 13.1 LXC 内（localhost）

```bash
curl -s http://127.0.0.1:3210/health/live
# {"status":"ok"}

curl -s http://127.0.0.1:3210/health/ready
# {"status":"ok", ...}  应返回 200
```

Readiness 检查项：SQLite 可查询、migrations 已完成、数据目录可写、`UID_SECRET` 已加载。异常时返回 **503**。

### 13.2 通过 Tunnel（公网）

```bash
curl -s https://timetable.leoze.top/health/live
curl -s https://timetable.leoze.top/health/ready
```

两者均应返回 200 和 `"status":"ok"`。

---

## 14. 首次同步测试

### 14.1 配置 Tampermonkey 脚本

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 将 [Script/seqta-calendar-sync.user.js](../Script/seqta-calendar-sync.user.js) 导入 Tampermonkey
3. 登录 SEQTA Learn，打开课表页
4. 点击 **Calendar Settings**，填写：
   - **Backend URL：** `https://timetable.leoze.top`
   - **Upload token：** 上一步保存的 `scu_…`
5. 点击 **Sync Timetable**

详细说明见 [Script/README.md](../Script/README.md)。

### 14.2 验证同步 API（可选，curl 测试）

```bash
UPLOAD_TOKEN="scu_你的token"

curl -s -X POST "https://timetable.leoze.top/api/v1/sync" \
  -H "Authorization: Bearer ${UPLOAD_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "schemaVersion": 1,
    "schoolHost": "learn.example-school.edu.au",
    "studentRef": "4284",
    "timezone": "Australia/Sydney",
    "generatedAt": "2026-08-04T08:35:00+10:00",
    "coverage": [{"from": "2026-08-03", "until": "2026-08-09", "complete": true}],
    "lessons": [{
      "sourceKey": "2026-08-05|period-2|1575659",
      "date": "2026-08-05",
      "periodKey": "period-2",
      "periodLabel": "Period 2",
      "courseCode": "11MUS",
      "title": "Music 1",
      "teacher": "Mr Example",
      "room": "M202",
      "start": "09:35:00",
      "end": "10:30:00",
      "type": "class"
    }]
  }'
```

成功响应应包含 `"changed": true` 和 `"result"` 统计。

### 14.3 查看同步状态

```bash
curl -s "https://timetable.leoze.top/api/v1/status" \
  -H "Authorization: Bearer ${UPLOAD_TOKEN}"
```

### 14.4 下载并验证 ICS

```bash
curl -s "https://timetable.leoze.top/calendar/scc_你的token.ics" | head -30
```

应看到 `BEGIN:VCALENDAR` 和 `BEGIN:VEVENT` 块，且 `Content-Type` 为 `text/calendar`。

---

## 15. Apple Calendar 订阅

1. 复制创建 Feed 时输出的 **Calendar URL**（`https://timetable.leoze.top/calendar/scc_….ics`）
2. **Mac：** Calendar → File → New Calendar Subscription → 粘贴 URL
3. **iPhone/iPad：** Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → 粘贴 URL
4. 刷新间隔建议 1 小时（ICS 内已含 `REFRESH-INTERVAL;VALUE=DURATION:PT1H`）

**只需订阅一次。** 此后每次在 SEQTA 页面手动同步，Apple Calendar 会在下次刷新时获取更新。事件 `UID` 保持稳定，不会因老师/教室变更而产生重复事件。

若轮换 Calendar Token（`rotate-token --type calendar`），必须在 Apple Calendar 中删除旧订阅并添加新 URL。

---

## 16. 配置自动备份

SQLite 使用 WAL 模式，**不能只复制** `calendar.sqlite` 文件（可能同时存在 `-wal` 和 `-shm` 文件）。项目内置 backup CLI 使用 `better-sqlite3` 在线备份 + `integrity_check` + gzip。

### 16.1 手动测试备份

```bash
cd /opt/seqta-calendar/current

sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; \
  npm run cli -- backup --output /var/backups/seqta-calendar'
```

输出示例：

```json
{
  "event": "backup_completed",
  "source": "/var/lib/seqta-calendar/calendar.sqlite",
  "backup": "/var/backups/seqta-calendar/calendar-2026-08-04T....sqlite.gz"
}
```

### 16.2 安装 systemd 定时备份

```bash
cp /opt/seqta-calendar/current/deploy/seqta-calendar-backup.service /etc/systemd/system/
cp /opt/seqta-calendar/current/deploy/seqta-calendar-backup.timer /etc/systemd/system/

systemctl daemon-reload
systemctl enable seqta-calendar-backup.timer
systemctl start seqta-calendar-backup.timer
```

默认定时：**每天 02:30**（见 [deploy/seqta-calendar-backup.timer](../deploy/seqta-calendar-backup.timer)）。

查看下次执行时间：

```bash
systemctl list-timers seqta-calendar-backup.timer
```

### 16.3 备份内容与保留策略

每次备份应包含：

| 内容 | 路径 |
|------|------|
| SQLite 一致性快照 | `/var/backups/seqta-calendar/calendar-*.sqlite.gz` |
| 环境变量（含密钥） | `/etc/seqta-calendar.env` |
| 应用版本 | `package.json` 中的 version |

建议保留策略：

```text
7 个每日备份
4 个每周备份
3 个每月备份
```

### 16.4 复制到 NAS（可选）

使用 `rsync` 或 Synology Hyper Backup 将 `/var/backups/seqta-calendar/` 和 `/etc/seqta-calendar.env` 同步到 NAS。**NAS 目录必须限制访问** — 环境文件含 `TOKEN_PEPPER` 和 `UID_SECRET`。

示例 cron（root）：

```bash
rsync -a /var/backups/seqta-calendar/ nas:/volume1/backups/seqta-calendar/
rsync -a /etc/seqta-calendar.env nas:/volume1/backups/seqta-calendar/env/
```

---

## 17. 监控（Uptime Kuma）

推荐使用 [Uptime Kuma](https://github.com/louislam/uptime-kuma) 监控公开健康端点。

### 17.1 添加监控项

| 名称 | URL | 类型 |
|------|-----|------|
| seqta-calendar live | `https://timetable.leoze.top/health/live` | HTTP(s) |
| seqta-calendar ready | `https://timetable.leoze.top/health/ready` | HTTP(s) |

### 17.2 推荐参数

```text
Interval:  60 seconds
Retries:   3
Timeout:   10 seconds
```

### 17.3 告警条件（运维参考）

| 条件 | 说明 |
|------|------|
| `/health/ready` 连续 3 次失败 | 数据库或配置异常 |
| 数据库目录剩余空间 < 1 GB | 磁盘不足 |
| 备份连续 2 次失败 | 检查 backup timer 日志 |
| 最近 14 天无成功同步 | 检查 Tampermonkey / Token |
| `integrity_check` 失败 | 数据库可能损坏，需恢复 |

**不要用真实 Calendar Token URL 做公开监控** — Calendar URL 本身就是 Bearer Secret。

### 17.4 查看应用日志

```bash
journalctl -u seqta-calendar --since "1 hour ago" -o json-pretty
```

关键结构化事件：`service_started`、`sync_completed`、`sync_failed`、`calendar_served`、`backup_completed`、`backup_failed`。

Calendar URL 在日志中已脱敏为 `/calendar/[REDACTED].ics`。

---

## 18. 数据库恢复

当数据库损坏或需要回滚时：

```bash
# 1. 停止服务
systemctl stop seqta-calendar

# 2. 备份当前损坏的数据库
cp -a /var/lib/seqta-calendar /var/lib/seqta-calendar.broken-$(date +%Y%m%d)

# 3. 解压选定的备份
gunzip -c /var/backups/seqta-calendar/calendar-YYYY-MM-DD....sqlite.gz \
  > /var/lib/seqta-calendar/calendar.sqlite

# 4. 验证完整性
sqlite3 /var/lib/seqta-calendar/calendar.sqlite "PRAGMA integrity_check;"
# 应输出 ok

# 5. 修正 ownership
chown seqta-calendar:seqta-calendar /var/lib/seqta-calendar/calendar.sqlite
chmod 640 /var/lib/seqta-calendar/calendar.sqlite

# 6. 确认 /etc/seqta-calendar.env 中的 TOKEN_PEPPER 和 UID_SECRET 与备份时一致

# 7. 运行迁移（幂等）
cd /opt/seqta-calendar/current
sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; npm run db:migrate'

# 8. 启动并验证
systemctl start seqta-calendar
curl -s http://127.0.0.1:3210/health/ready
curl -s "https://timetable.leoze.top/calendar/scc_你的token.ics" | grep -c "BEGIN:VEVENT"
```

**密钥丢失后果：**

- `UID_SECRET` 丢失 → 未来新事件会生成不同的 ICS UID，Apple Calendar 可能出现重复
- `TOKEN_PEPPER` 丢失 → 所有现有 Token 无法验证，必须重新 `create-feed` 或轮换

因此 `/etc/seqta-calendar.env` **必须与数据库一起备份**。

---

## 19. 注意事项

### 19.1 网络安全

| 规则 | 原因 |
|------|------|
| `HOST=127.0.0.1`，端口 3210 | 只有同 LXC 内的 cloudflared 可访问；关闭 Tunnel 后服务不暴露公网 |
| 不使用 Nginx 反向代理到 `0.0.0.0` | 避免绕过 localhost 绑定 |
| SQLite 数据库不对公网开放 | 无 PostgreSQL/MySQL 端口，减少攻击面 |
| Cloudflare Tunnel 出站连接 | PVE/LXC 防火墙无需开放入站 443/80 |

### 19.2 Token 与密钥

| 规则 | 原因 |
|------|------|
| Upload Token（`scu_…`）和 Calendar Token（`scc_…`）只显示一次 | 数据库存 Hash，无法恢复明文 |
| Calendar URL 即 Bearer Secret | 不要使用可预测的 URL（如 `/calendar/leo.ics`） |
| `TOKEN_PEPPER` ≠ `UID_SECRET` | 用途不同，共用会降低安全性 |
| 两者必须与 DB 一起备份 | 丢失后 Token 或 UID 失效（见 §18） |
| 日志不记录 Token、Authorization、完整 Calendar URL | 见 [docs/security.md](security.md) |

### 19.3 SQLite / WAL 约束

| 规则 | 原因 |
|------|------|
| **只运行一个** `seqta-calendar` 进程 | WAL 模式不支持多进程写 |
| 不使用 Node.js Cluster | 同上 |
| 数据库必须在 LXC **本地磁盘** | WAL 不支持 NFS/SMB 网络文件系统 |
| NAS 仅用于备份，不用于实时 DB | 避免 corruption |
| 备份使用 `npm run cli -- backup`，不要 `cp calendar.sqlite` | WAL 模式下直接复制可能不一致 |
| 同一 Feed 同时只允许一个写事务 | 并发 sync 返回 `409 SYNC_ALREADY_RUNNING` |

应用启动时自动设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

### 19.4 Cloudflare 配置

| 规则 | 原因 |
|------|------|
| `/calendar/*` 设置 **Bypass cache** | 避免 Apple Calendar 拿到 stale 课表 |
| 不要把整个 hostname 放在 Cloudflare Access 后 | Apple Calendar 无法交互式登录 |
| 可对 `/api/v1/sync` 额外配置 WAF Rate Limit | 应用层已有 10 次/10 分钟/upload token |
| `TRUST_PROXY=true` | 让 Fastify 正确识别 Cloudflare 传来的客户端 IP（用于 calendar rate limit） |

### 19.5 CORS 与 Tampermonkey

| 规则 | 原因 |
|------|------|
| `ALLOWED_ORIGINS` 必须精确匹配 SEQTA Origin | 不允许 `*`，防止任意网站调用 sync API |
| Tampermonkey 使用 `GM_xmlhttpRequest` | 绕过浏览器 CORS，但后端仍校验 Origin |
| `@connect` 必须包含后端域名 | 见 [Script/README.md](../Script/README.md) |

### 19.6 升级与维护

更新应用版本：

```bash
systemctl stop seqta-calendar

# 部署新代码（git pull / rsync）
cd /opt/seqta-calendar/current
sudo -u seqta-calendar npm ci
sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; npm run build'
sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; npm run db:migrate'

systemctl start seqta-calendar
curl -s http://127.0.0.1:3210/health/ready
```

Token 轮换：

```bash
sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; \
  npm run cli -- rotate-token --feed <feed-id> --type upload'

sudo -u seqta-calendar bash -c 'set -a; source /etc/seqta-calendar.env; set +a; \
  npm run cli -- rotate-token --feed <feed-id> --type calendar'
```

- 轮换 Upload Token → 更新 Tampermonkey 配置；Apple Calendar 不受影响
- 轮换 Calendar Token → 必须在 Apple Calendar 重新订阅新 URL

### 19.7 数据不收集

后端**不**接收或存储：SEQTA 用户名、密码、Cookie、Session、原始 SEQTA API 响应。

---

## 附录：初始化检查清单

```text
□ LXC 已创建（Debian 13, 1 vCPU, 1 GB RAM, 非特权）
□ Node.js 24 已安装
□ seqta-calendar 用户与目录已创建
□ 代码已部署到 /opt/seqta-calendar/current
□ /etc/seqta-calendar.env 已配置（含独立 TOKEN_PEPPER 和 UID_SECRET）
□ npm ci && npm run build && npm run db:migrate 成功
□ create-feed 已执行，Token 已安全保存
□ systemd seqta-calendar.service 已启用且 active
□ Cloudflare Tunnel 已配置，/calendar/* Bypass cache
□ /health/live 和 /health/ready 公网可达
□ Tampermonkey 首次同步成功
□ ICS 可下载且含 VEVENT
□ Apple Calendar 已订阅
□ backup timer 已启用
□ Uptime Kuma 已监控 health 端点
□ /etc/seqta-calendar.env 已纳入备份
```

---

*文档版本：1.0 · 与 [文档.md](../文档.md) §23–§27 保持一致*
