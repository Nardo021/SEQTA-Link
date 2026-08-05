# Seqta Link — Proxmox VE 部署指南

在 **Proxmox VE** 的 **Debian LXC** 上部署 **Seqta Link v3.1.2**（Flask + SQLite，单进程）。

**相关文档：** [docs/api-v2.md](api-v2.md) · [script/README.md](../script/README.md) · [.env.example](../.env.example)

> **命名说明：** 产品名为 Seqta Link。下文 `/opt/seqta-calendar`、`seqta-calendar.service` 等为历史部署路径，可继续沿用。

> **Shell 前提：** LXC 内通常为 **root**。命令按 root 编写；需要以 `seqta-calendar` 用户运行时，用 `runuser -u seqta-calendar -- …`。

---

## 1. 架构

```text
Internet → Cloudflare Tunnel → LXC (127.0.0.1:3210)
                                 └── gunicorn (systemd)
                                       └── Flask + SQLite (WAL)
                                             DATABASE_PATH=/var/lib/seqta-calendar/seqta.db
```

| 路径                               | 用途                             |
| ---------------------------------- | -------------------------------- |
| `/opt/seqta-calendar/current`      | 应用代码 + Python venv           |
| `/var/lib/seqta-calendar/seqta.db` | SQLite 数据库（`DATABASE_PATH`） |
| `/etc/seqta-calendar.env`          | 环境变量                         |
| `/var/backups/seqta-calendar`      | `flask backup` 复制的数据库文件  |

模板：`deploy/seqta-calendar.service`、`deploy/cloudflared-example.yml`、`deploy/seqta-calendar-backup.timer`。

> v3 使用 SQLite，**不再**需要内嵌/外部 PostgreSQL 或 `pg_dump`。

---

## 2. LXC 与系统依赖

推荐：Debian 12/13、1 vCPU、512 MB–1 GB RAM、unprivileged LXC、**Python 3.11+**。

```bash
apt update && apt install -y python3 python3-venv python3-pip curl ca-certificates
python3 --version   # 3.11+
```

创建运行用户与目录：

```bash
useradd --system --home /opt/seqta-calendar --shell /usr/sbin/nologin seqta-calendar
mkdir -p /opt/seqta-calendar /var/lib/seqta-calendar /var/backups/seqta-calendar
chown -R seqta-calendar:seqta-calendar /opt/seqta-calendar /var/lib/seqta-calendar /var/backups/seqta-calendar
```

---

## 3. 部署应用

将仓库放到 `/opt/seqta-calendar/current`，创建虚拟环境并安装：

```bash
cd /opt/seqta-calendar/current
python3 -m venv /opt/seqta-calendar/venv
runuser -u seqta-calendar -- /opt/seqta-calendar/venv/bin/pip install -e .
```

配置环境文件：

```bash
cp .env.example /etc/seqta-calendar.env
chmod 600 /etc/seqta-calendar.env
chown seqta-calendar:seqta-calendar /etc/seqta-calendar.env
```

编辑 `/etc/seqta-calendar.env`，生产必须设置：

| 变量                                             | 说明                               |
| ------------------------------------------------ | ---------------------------------- |
| `PUBLIC_BASE_URL`                                | 公网 HTTPS 地址                    |
| `DATABASE_PATH`                                  | `/var/lib/seqta-calendar/seqta.db` |
| `TOKEN_PEPPER` / `UID_SECRET` / `SESSION_SECRET` | 互不相同，base64 ≥32 字节          |
| `COOKIE_SECURE`                                  | `true`                             |
| `AUTH_DEV_LOGIN`                                 | `false`                            |
| `HOST`                                           | `127.0.0.1`                        |
| `PORT`                                           | `3210`                             |

初始化数据库与 owner：

```bash
cd /opt/seqta-calendar/current
set -a && source /etc/seqta-calendar.env && set +a

runuser -u seqta-calendar -- /opt/seqta-calendar/venv/bin/flask --app run:app init-db
runuser -u seqta-calendar -- /opt/seqta-calendar/venv/bin/flask --app run:app bootstrap-owner
# 按提示输入邮箱与密码
```

启用 systemd（`deploy/seqta-calendar.service` 示例）：

```ini
ExecStart=/opt/seqta-calendar/venv/bin/gunicorn -w 1 -b 127.0.0.1:3210 run:app
```

```bash
cp deploy/seqta-calendar.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now seqta-calendar
```

经 Cloudflare Tunnel 将 HTTPS 流量转发到 `127.0.0.1:3210`。

---

## 4. 日常运维

**CLI 一览（Flask）：**

| 命令                                  | 用途                              |
| ------------------------------------- | --------------------------------- |
| `flask --app run:app init-db`         | 创建 SQLite 表 + WAL              |
| `flask --app run:app bootstrap-owner` | 创建 owner 账号                   |
| `flask --app run:app backup`          | 复制数据库到 `backups/seqta-*.db` |

**备份示例：**

```bash
cd /opt/seqta-calendar/current
set -a && source /etc/seqta-calendar.env && set +a
runuser -u seqta-calendar -- /opt/seqta-calendar/venv/bin/flask --app run:app backup
# 可将 backups/ 下文件 rsync 到 /var/backups/seqta-calendar
```

定时备份可修改 `deploy/seqta-calendar-backup.service` 为：

```ini
ExecStart=/opt/seqta-calendar/venv/bin/flask --app run:app backup
WorkingDirectory=/opt/seqta-calendar/current
EnvironmentFile=/etc/seqta-calendar.env
```

**健康检查：**

- `GET /health/live` → 进程存活
- `GET /health/ready` → SQLite 可连接

**账号：** 本地邮箱密码；新用户必须邀请（`/admin/invitations` → 邀请链接 `/invite?token=…`）。Owner 通过 `bootstrap-owner` 或首次启动时的 `OWNER_BOOTSTRAP_*` 创建。

**门户：**

| 路径     | 功能                                                          |
| -------- | ------------------------------------------------------------- |
| `/app`   | Dashboard、Devices 配对、Calendar 订阅、Sync history、Account |
| `/admin` | 用户管理、邀请、审计日志                                      |

**同学接入：** Portal → Devices 生成配对码 → Tampermonkey **Pair device** → Sync（`POST /api/v2/sync`）→ Calendar 页轮换订阅 URL → Apple/Google 日历 URL 订阅。

---

## 5. 安全要点

- 服务只绑 loopback；公网走 Tunnel / 反向代理
- Token / Calendar URL 轮换后只通过 flash 显示一次；库内仅存 hash
- 生产 `COOKIE_SECURE=true`；HTTP 下 cookie 不会写入
- 登录与配对有失败锁定（进程内存；单实例部署）
- 定期备份 `DATABASE_PATH` 与 `/etc/seqta-calendar.env`（含 pepper/secrets）
- SQLite 单写者：不要水平扩展多个 gunicorn worker 写同一库（`-w 1`）

---

## 6. 从 v2（Node/Postgres）迁移

v3 是全新栈，无自动迁移工具。建议：

1. 在新 LXC 部署 v3。
2. 用户重新注册（邀请）并重新配对设备。
3. Tampermonkey 更新为 v3 userscript（`/api/v2/*`，`sl_dvc_` 令牌）。
4. 旧 Postgres 数据可归档备份，不导入 SQLite。

---

_文档版本：Seqta Link 3.1.2 · Flask + SQLite · gunicorn · root 下部署_
