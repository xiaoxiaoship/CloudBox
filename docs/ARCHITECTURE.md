# CloudBox 架构与实现原理 / Architecture & Implementation

> 适用版本：1.0.2  
> Applies to: 1.0.2

## 本文目录 / Contents

```text
架构与实现原理
├── 1. 总览
├── 2. 进程与目录
├── 3. 主进程
├── 4. HTTP 服务
├── 5. 核心服务层
├── 6. 数据模型与迁移
├── 7. 请求与上传流程
├── 8. 预览与并发控制
├── 9. 安全策略引擎
├── 10. frp、HTTPS 与 CA
├── 11. 插件运行时
├── 12. 前端
├── 13. 测试、构建与发布
└── 14. English
```

---

# 中文

## 1. 总览

CloudBox 是 Electron 桌面应用 + 内嵌 Express 服务 + SQLite 数据库。

```text
Electron
├── 主进程（Node.js）
│   ├── IPC / 管理端窗口
│   ├── Express HTTP 服务
│   ├── SQLite
│   ├── frpc / CA / 证书
│   └── 插件子进程
├── 管理端（React，file:// 或本地打包）
└── Web 用户端（React，经 HTTP 提供）
```

## 2. 进程与目录

```text
src/
├── main/        Electron 主进程、IPC、窗口、托盘、服务控制
├── core/        领域模型、数据库、服务、安全与业务逻辑
├── server/      Express 路由、中间件、上传、下载、Cap、IPS
├── preload/     contextBridge 暴露的 admin API
├── shared/      IPC 类型、共享模型、i18n 文案
admin/           管理端 React
web/             Web 用户端 React
tests/           单元/集成测试
docs/            文档
resources/       图标、二进制、示例插件
```

运行数据默认：

- `dataDir`：数据库、密钥、证书、frp 配置
- `storageRoot`：用户文件
- `pluginsDir`：插件与插件 storage

## 3. 主进程

`src/main/index.ts`：

- 单实例锁
- 创建主窗口/托盘
- 初始化 `MainContext`
- 注册 IPC
- 启动 HTTP 服务和插件
- 退出时停止插件、frp、HTTP

`src/main/context.ts` 负责装配数据库、服务、密钥、路径。

`src/main/ipc.ts` 是管理端与主进程的边界：

- Zod 校验输入
- 管理员鉴权
- 调用服务
- 写审计
- 返回 `AdminSettings` / 状态对象

## 4. HTTP 服务

`src/server/app.ts` 是 Express 装配入口：

```text
Helmet / requestId / body parser / traffic
IPS 中间件
健康检查
API 全局 IP 守卫
基础限流
API 泛洪计数
Cap 路由
公开配置 / 证书 / 插件主题
托管站点
AI / 系统 / 插件 / 分享 / 认证 / 文件 / 任务路由
错误处理
```

安全顺序很重要：

1. IPS 在鉴权前做攻击特征短路。
2. `/api` 的 IP 全局封禁在路由前。
3. Cap 在登录/注册内触发。
4. `requireUser` 校验 Session、账户封禁、只读模式、CSRF。
5. CSRF 中间件保护写请求。

## 5. 核心服务层

`src/core/services/`：

- `AuthService`：注册/登录/会话/密码/旧锁定
- `RegistrationService`：公开注册、配额创建
- `SecurityPolicyService`：高级策略、封禁、计数、重置
- `FileService`：安全路径、列表、移动、预览、下载
- `ExtractionService`：7-Zip 解压与路径校验
- `ScanService`：ClamAV / VirusTotal
- `ShareService`：分享令牌与有效期
- `HostingService`：静态站点
- `PluginService`：插件生命周期与 IPC
- `MailService`：SMTP 事件与冷却
- `SettingsService`：带 Schema 的设置读写
- `AuditService`：审计日志

## 6. 数据模型与迁移

SQLite 迁移位于 `src/core/db/migrations/`，按编号执行并记录 `schema_migrations` 与 `user_version`。

主要表：

- `users`、`sessions`、`quotas`
- `shares`
- `file_scans`
- `audit_logs`
- `plugins`
- `settings`
- `user_login_ips`
- `security_bans`
- `security_policy_resets`
- `security_policy_counts`

重置表用于“解封后旧计数不应立即重新触发”。

## 7. 请求与上传流程

上传：

```text
POST /api/files/upload
→ requireUser + CSRF
→ busboy 流式解析
→ 文件名/路径校验
→ 配额检查
→ 临时文件
→ 原子移动到用户目录
→ 审计
```

路径安全：

- `normalizeRelativePath`
- 拒绝 `..`、绝对路径、Windows 保留设备名
- 解压后再次校验目标路径
- 下载/预览/分享都通过 safePath

## 8. 预览与并发控制

`FileService` 根据扩展名 + 魔数识别类型：

- 图片：PNG/JPEG/GIF/WebP/BMP
- 视频：MP4/WebM/Ogg
- 音频
- PDF
- Office：docx/xlsx/pptx
- 文本/代码

并发：

- `heavyPreviewGate`：PDF/Office/大视频全局并发
- 每用户预览信号量
- 等待超过 3 秒返回 429 `PREVIEW_BUSY`
- 普通图片/文本只受单用户并发限制
- 解压/查杀使用独立并发门

## 9. 安全策略引擎

策略保存在 `settings.security.policy`：

```json
{
  "rules": [],
  "savedRules": [],
  "ipBan": {},
  "accountBan": {},
  "globalBan": {},
  "accessLists": {}
}
```

执行：

```text
rule(feature, scope) → 读取配置
→ 业务统计（审计/在线数/请求数/特征匹配）
→ ban(scope, target, feature, minutes)
→ security_bans
→ 记录计数
→ 达到记录值阈值升级为 global
```

模式互斥：

- `simple`：旧硬编码锁定/限流，不执行策略 JSON。
- `advanced`：策略引擎 + IPS + 黑白名单，不执行旧锁定。

模式切换会清除旧封禁/计数，避免互相污染。

时间语义：

- `0`：永久
- 留空（内部 `-1`）：仅计数、不封禁
- 可变封禁：`base × 2^次数`，受 `max` 限制

## 10. frp、HTTPS 与 CA

- `frpConfig.ts` 生成 frpc 配置。
- HTTP/HTTPS 隧道保留真实 IP。
- TCP 可选 PROXY Protocol v2。
- `tcpMux` 写入顶层 `[transport]`。
- `CaManager` 使用 `node-forge` / mkcert 生成 CA 与证书。
- 网络变更失败时回滚端口/证书配置。

## 11. 插件运行时

```text
主进程
→ fork 插件 index.js
→ IPC 请求转发
→ 返回 {status, headers, body}
```

插件只看到受限 ctx；不能直接访问主进程对象或用户文件。

## 12. 前端

- `admin/`：Electron 管理端，使用 preload 暴露的 IPC。
- `web/`：用户端，使用 HTTP API + Cookie/CSRF。
- 状态管理：Zustand（Web）。
- i18n：i18next + 共享文案 + 历史字符串映射。
- 文件上传：前端队列限制最多 10 个并发。

## 13. 测试、构建与发布

```bash
npm run typecheck
npm test
npm run build:web
npm run build:desktop
npm run dist:win
```

测试：

- `tests/integration/`：真实 Express + 临时 SQLite
- 安全策略、IPS、API 泛洪、并发、上传、分享、托管、邮件
- `scripts/pentest.ts`：本地 PTES 检查

发布：

- `electron-builder.yml` 生成 NSIS 安装包与便携版
- 未配置代码签名时 Windows 会提示未知发布者
- `release/` 不提交到 Git

---

# English

## 1. Overview

CloudBox is an Electron desktop app with an embedded Express server and SQLite.

```text
Electron
├── main process (Node.js)
│   ├── IPC / admin window
│   ├── Express HTTP server
│   ├── SQLite
│   ├── frpc / CA / certificates
│   └── plugin child processes
├── admin UI (React, local bundle)
└── Web UI (React, served over HTTP)
```

## 2. Processes and directories

```text
src/main/      Electron main, IPC, window, tray, service control
src/core/      domain models, DB, services, security/business logic
src/server/    Express routes, middleware, upload, download, Cap, IPS
src/preload/   contextBridge admin API
src/shared/    IPC types, shared models, i18n strings
admin/         admin React UI
web/           Web React UI
tests/         unit/integration tests
docs/          documentation
resources/     icons, binaries, sample plugins
```

Runtime data:

- `dataDir`: database, keys, certificates, frp config
- `storageRoot`: user files
- `pluginsDir`: plugins and plugin storage

## 3. Main process

`src/main/index.ts` owns the single-instance lock, window/tray, context bootstrap, IPC, HTTP service, plugins and shutdown.

`src/main/ipc.ts` is the admin boundary: Zod validation, admin authorization, service calls, audit and settings/status responses.

## 4. HTTP service

`src/server/app.ts` assembles:

```text
Helmet / requestId / body parser / traffic
IPS middleware
health
global IP guard
baseline rate limiting
API flood counting
Cap routes
public settings / CA / plugin theme
hosting
AI / system / plugins / shares / auth / files / tasks
error handler
```

Ordering matters:

1. IPS before authentication.
2. Global IP bans before API routes.
3. Cap inside login/registration.
4. `requireUser` validates session, account bans, read-only mode and CSRF.
5. CSRF protects mutations.

## 5. Core services

`src/core/services/` contains auth, registration, security policy, files, extraction, scanning, shares, hosting, plugins, mail, settings and audit.

## 6. Data model and migrations

Migrations are numbered under `src/core/db/migrations/`, tracked in `schema_migrations` and `user_version`.

Main tables:

- `users`, `sessions`, `quotas`
- `shares`
- `file_scans`
- `audit_logs`
- `plugins`
- `settings`
- `user_login_ips`
- `security_bans`
- `security_policy_resets`
- `security_policy_counts`

Reset/count tables prevent old counters from immediately re-triggering after an unban.

## 7. Request and upload flow

```text
POST /api/files/upload
→ requireUser + CSRF
→ busboy streaming
→ filename/path validation
→ quota check
→ temp file
→ atomic move into user directory
→ audit
```

Path safety rejects `..`, absolute paths and Windows reserved device names; extraction and download/preview/share all use safePath.

## 8. Preview and concurrency

`FileService` detects type by extension + magic bytes:

- images, video, audio, PDF, Office, text/code

Concurrency:

- global heavy-preview gate for PDF/Office/large video
- per-user preview semaphore
- 3-second wait then 429 `PREVIEW_BUSY`
- images/text do not use the heavy queue
- extraction and scanning use independent gates

## 9. Security policy engine

Policy JSON lives in `settings.security.policy` and contains `rules`, `savedRules`, IP/account/global ban settings and access lists.

Execution:

```text
rule(feature, scope) → config
→ business metric (audit/session/request/signature)
→ ban(scope, target, feature, minutes)
→ security_bans
→ count
→ record-value threshold promotes to global
```

Mode isolation:

- `simple`: legacy locks/rate limits; no policy JSON.
- `advanced`: policy engine + IPS + lists; no legacy locks.
- Switching modes clears state to avoid cross-contamination.

Time semantics:

- `0`: permanent
- blank (`-1` internally): count only, no ban
- variable: `base × 2^count`, capped by `max`

## 10. frp, HTTPS and CA

- `frpConfig.ts` generates frpc config.
- HTTP/HTTPS preserves real IP.
- TCP supports PROXY Protocol v2.
- `tcpMux` is written to top-level `[transport]`.
- `CaManager` creates CA/certificates with node-forge/mkcert.
- Failed network changes roll back.

## 11. Plugin runtime

```text
main → fork index.js → IPC request forwarding → {status, headers, body}
```

Plugins only see the restricted ctx and cannot directly access main-process objects or user files.

## 12. Frontend

- `admin/`: Electron admin, uses preload IPC.
- `web/`: user UI over HTTP with cookies/CSRF.
- Zustand state (Web), i18next strings, upload queue limited to 10 concurrent uploads.

## 13. Tests, build and release

```bash
npm run typecheck
npm test
npm run build:web
npm run build:desktop
npm run dist:win
```

Integration tests use a real Express server and temporary SQLite. `scripts/pentest.ts` provides local PTES checks.

`electron-builder.yml` produces NSIS and portable builds. Without code signing Windows shows an unknown-publisher warning. `release/` is not committed.
