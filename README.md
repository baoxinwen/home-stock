# 家庭库存助手（Home Stock）

面向家庭、自托管的轻量库存助手：记录食品/药品的购买、保质期与开封状态，临期与过期提醒（企业微信 + 邮件 + 应用内，三态收件箱管理），购物清单转库存（同名自动聚合），浪费/入库/库存健康统计仪表盘，浅色/深色主题。数据只保存在自己的 NAS 上。

- 技术栈：NestJS 10 + SQLite（better-sqlite3 / Drizzle）+ Vue 3 + Vite PWA
- 单容器部署（API、前端静态文件、提醒/备份定时任务同进程），避免多进程写 SQLite
- 访问口令（`ACCESS_TOKEN`）保护所有 API；前端登录一次后记住
- PC（≥1024px）自动切换为仪表盘布局：顶部导航 + 总览首页（KPI / 浪费趋势 / 临期提醒 / 分类明细 / 最近动态）；移动端保持单列 + 底部标签栏

---

## 1. 快速开始（Docker Compose）

前提：NAS/服务器已安装 Docker 与 Docker Compose v2。

```bash
# 建数据目录（数据库 + 备份都会落在这里）
mkdir -p data

# 设置访问口令（必填；请换成自己的强口令）
export ACCESS_TOKEN='请换成至少 16 位的随机口令'

# 构建并启动
docker compose up -d --build

# 查看状态 / 日志
docker compose ps
docker compose logs -f app
```

打开 `http://<NAS-IP>:3000`，在登录页输入 `ACCESS_TOKEN` 即可使用。容器健康检查访问 `GET /api/health`（该接口豁免口令，供 Docker/反向代理探活）。

> 也可以把变量写进同目录的 `.env` 文件（不要提交到 git）：
>
> ```dotenv
> ACCESS_TOKEN=change-me-to-a-long-random-secret
> TZ=Asia/Shanghai
> ```

### 升级

```bash
git pull
docker compose up -d --build
```

数据保存在 `./data`，重建容器不会丢失。应用启动时会自动执行数据库迁移。

### 备份数据目录

`./data` 同时包含 `stock.db` 与 `backups/`。除应用内备份外，也可定期用 NAS 快照/rsync 备份整个 `data/` 目录。

---

## 2. 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ACCESS_TOKEN` | 访问口令，**生产必填**；所有 `/api/*`（除 `/api/health`）都要校验 | 无（compose 中强制要求） |
| `TZ` | 时区，影响提醒时刻、备份文件名与统计月份 | `Asia/Shanghai` |
| `DATA_DIR` | 数据目录，SQLite 主库为 `${DATA_DIR}/stock.db` | `/data` |
| `BACKUP_DIR` | 备份目录（定时备份 + 恢复前安全备份） | `/data/backups` |
| `BACKUP_INTERVAL` | 定时备份 cron 表达式（5 段） | `0 2 * * *`（每日 02:00） |
| `BACKUP_KEEP` | 备份保留份数（`stock-*` 与 `pre-restore-*` 一起按修改时间删旧；`0` = 不保留） | `14` |
| `BACKUP_MAX_BYTES` | 备份目录总大小上限，超过后继续删最旧的一份 | `2147483648`（2 GiB） |
| `BACKUP_MAX_UPLOAD_BYTES` | 单次上传恢复的体积上限（超过返回 413，不进入恢复流程） | `134217728`（128 MiB） |
| `PUBLIC_DIR` | 前端静态目录（一般不用改） | `/app/public` |

通知渠道凭据（SMTP、企业微信 corpid/secret/agentid）**不写在环境变量里**，统一在应用「设置」页配置并保存在数据库中（GET 时脱敏为 `***`）。

`ACCESS_TOKEN` 的行为（fail-closed）：

- 设置了：请求需带 `X-Access-Token: <口令>`；`?token=<口令>` **仅备份下载类 GET 端点**（`/api/backup`、`/api/backup/list`）可用，供手动下载链接场景——应用内下载已走 Header 鉴权，其余接口（含写接口）一律不接受 query 口令，避免口令进访问日志/浏览器历史。
- **只有 `NODE_ENV` 显式为 `development` / `test` 时才允许留空**；`production` 或未设置 `NODE_ENV` 时启动会直接失败退出（不会带着裸奔的 API 跑起来）。
- 口令启动时 `trim()` 去掉首尾空白，空白视为未配置；长度不足 8 位会拒绝启动。
- 口令比较使用常量时间比较（SHA-256 归一化 + `timingSafeEqual`）。
- 鉴权覆盖大小写任意变体（`/api/items`、`/API/items`、`/Api/items` 都校验），中间件挂在 `/api` 上，靠挂载路径大小写不敏感堵住绕过。
- `/api/health` 与前端静态资源免鉴权，保证健康检查与登录页可访问。

---

## 3. 通知渠道配置

进入「设置」页填写后点「发送测试邮件 / 发送测试消息」验证；失败原因会显示在页面底部「最近渠道日志」。

### 企业微信（首选）

1. 用个人身份注册企业微信（个人也可创建「企业/组织」，无需公司认证）。
2. 管理后台 →「应用管理」→ 创建自建应用，记录 **AgentId** 与 **Secret**。
3. 「我的企业」→ 记录 **企业 ID（corpid）**。
4. 应用「可见范围」里加入需要接收提醒的成员（接收人可填 `@all` 或成员账号）。
5. 应用设置页勾选「启用企业微信提醒」，填入 corpid / agentid / secret / 接收人。

### 邮件（SMTP）

以 QQ 邮箱为例：

1. 邮箱设置 → 开启 SMTP 服务，获取**授权码**（不是登录密码）。
2. 设置页填写：SMTP 服务器 `smtp.qq.com`、端口 `465`、勾选 SSL/TLS、账号、授权码、发件人、收件人。
3. 勾选「启用邮件提醒」并发送测试邮件。

> 企业微信/邮件任一渠道失败只写日志，不会阻断其他渠道，也不会阻断提醒入库。

---

## 4. 备份与恢复

### 应用内

「设置」页 →「备份与恢复」：

- **备份下载**：服务端用 SQLite 在线备份 API 生成一致性快照（WAL 模式安全），以 `stock-YYYYMMDD-HHmmss.db` 下载。
- **上传恢复**：选择 `.db` 文件 → 二次确认 → 服务端依次：
  1. 校验 SQLite 魔数、完整性（`quick_check`）与必需表；
  2. 把当前库自动备份到 `${BACKUP_DIR}/pre-restore-<时间戳>.db`；
  3. 关闭连接 → 替换主库 → 重新打开（自动补跑迁移）；
  4. 任一步失败自动用安全备份回滚，主库仍可用；
  5. 返回恢复后的物品/类别/清单/通知/设置数量摘要。
- **备份列表**：显示 `BACKUP_DIR` 下的文件名、大小、修改时间。

并发恢复有进程内锁：同时发起两次只会成功一次，另一个返回 `409 RESTORE_IN_PROGRESS`。

### 定时备份

`BACKUP_INTERVAL`（默认每日 02:00）触发，快照写入 `BACKUP_DIR`，文件名 `stock-YYYYMMDD-HHmmss.db`；每次成功后按 `BACKUP_KEEP` 删除最旧的定时备份。`pre-restore-*` 安全备份与定时备份一起参与 `BACKUP_KEEP` / `BACKUP_MAX_BYTES` 清理（见 §2），不会被永久保留；需要长期留存的重要备份请及时从备份目录手动拷走。另外，备份目录总大小超过 `BACKUP_MAX_BYTES` 时会从最旧的开始删——单个备份文件体积一旦超过该上限，它永远不会被保留，会在下一次清理时被删除。

### 手工兜底

```bash
# 停服后打包整个 data/（包含 stock.db 与可能的 -wal/-shm，避免漏掉 WAL 中已提交的数据）
docker compose stop app
tar czf "home-stock-data-$(date +%Y%m%d-%H%M%S).tar.gz" data
docker compose start app
```

恢复失败且自动回滚也失败时：停容器，把最新的 `data/backups/pre-restore-*.db` 覆盖为 `data/stock.db`，删除同目录 `stock.db-wal` / `stock.db-shm`，再启动。

---

## 5. 域名 + HTTPS（可选 Caddy）

1. 域名 A/AAAA 解析到 NAS 公网 IP。
2. 路由器把 80/443 转发到 NAS。
3. 取消 `docker-compose.yml` 中 `caddy` 段与文件末尾 `volumes` 的注释。
4. 设置域名并启动：

```bash
export ACCESS_TOKEN='...'
export DOMAIN='stock.example.com'
docker compose up -d --build
```

Caddy 读取仓库根目录 `Caddyfile`，自动申请/续期证书并反代到 `app:3000`。启用 Caddy 后建议把 app 的端口映射改为仅本机（`127.0.0.1:3000:3000`），只暴露 80/443。

---

## 6. 开发与测试

```bash
pnpm install
pnpm -r test     # shared + server(Vitest/supertest) + web(Vitest/happy-dom)
pnpm -r build    # shared tsc / server nest build / web vue-tsc + vite build
```

e2e（Playwright 系统测试，真实 server + SQLite + 双视口）：

```bash
pnpm install
# 先在 apps/e2e 目录下安装浏览器，保证版本与 lockfile 锁定的 @playwright/test 匹配
cd apps/e2e && npx playwright install chromium && cd ../..

pnpm --filter @home-stock/e2e test:e2e
```

- 双视口项目：`mobile`（375×667）与 `desktop`（1280×720），共用前置 `setup` 项目的登录态。
- e2e 固定占用 **3000 端口**且 `reuseExistingServer=false`：端口被占用（如本地 dev server 还开着）会直接报错退出，不会静默复用已有进程——先停掉占用进程再跑。
- 每次运行在 `apps/e2e/.e2e-data/run-*` 下生成全新数据库，截图输出到仓库根 `.superpowers-shots/`。

本地开发（隔离实例：API 3001 + Vite 5173，不占用 e2e 的 3000，也不污染部署数据目录）：

```bash
# 终端 1：server（独立数据目录 .dev-data/stock.db，口令必填）
ACCESS_TOKEN=dev-token-home-stock-2026 DATA_DIR=.dev-data pnpm --filter @home-stock/server build
ACCESS_TOKEN=dev-token-home-stock-2026 DATA_DIR=.dev-data pnpm --filter @home-stock/server start

# 终端 2：web（vite.config.dev.ts 代理 /api 到 3001）
pnpm --filter @home-stock/web exec vite --config vite.config.dev.ts
```

打开 `http://localhost:5173`，登录页输入 `dev-token-home-stock-2026`。开发数据与 e2e（3000 全新库）、部署（./data）互相隔离。`NODE_ENV=test` 时 `x-force-db-error` 测试钩子才生效。

---

## 7. 故障排查

| 现象 | 处理 |
|---|---|
| `docker compose up` 报 `ACCESS_TOKEN is required` | 先 `export ACCESS_TOKEN=...` 或写进 `.env` |
| 容器 unhealthy | `docker compose logs app`；确认 3000 端口未占用、`/api/health` 可访问 |
| 登录一直提示口令错误 | 核对 compose/.env 的 `ACCESS_TOKEN`；改过之后需重建容器 |
| 企业微信/邮件收不到 | 设置页发测试消息看「最近渠道日志」；检查 corpid/agentid/secret、可见范围、SMTP 授权码/端口 |
| 恢复后数据没变 | 确认上传的是本应用的 `.db` 备份；`BACKUP_DIR` 下会留有 `pre-restore-*` 安全备份 |
| 时区/提醒时刻不对 | 核对 `TZ`，容器内 `date` 应与本地一致 |
| 磁盘占用增长 | 调小 `BACKUP_KEEP`；清理 `data/backups` 下旧的手工/安全备份 |

---

## 8. 安全说明

- 服务默认 HTTP；公网访问务必启用 Caddy（HTTPS）或放在已有反代之后。
- `ACCESS_TOKEN` 请使用足够长的随机串，并只通过 `.env`/环境变量注入，不要提交到仓库。
- 口令保存在浏览器 `localStorage`，共用设备请在「设置 → 退出登录」清理。
- 备份文件包含全部家庭数据，请妥善保管 `data/backups` 与下载到本地的快照。
