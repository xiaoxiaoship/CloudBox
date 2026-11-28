# CloudBox 架构与实现原理 / Architecture & Implementation

> 适用版本：1.0.3  
> Applies to: 1.0.3

## 目录 / Contents

```text
1. 运行形态
2. 进程与目录
3. Electron 入口
4. Headless / Web Admin 入口
5. 管理员认证与安全边界
6. 用户 Web
7. 核心服务
8. 数据模型与迁移
9. 安全策略引擎
10. 文件、预览、解压与查杀
11. frp、HTTPS 与 CA
12. 插件运行时
13. 前端与 AdminApi
14. 测试、构建与发布
15. 已知限制
```

---

## 1. 运行形态

CloudBox 1.0.3 有两种运行形态，共享 core/services 和 SQLite，但入口与部署不同。

```text
Electron GUI
├── 主进程
├── 桌面窗口 + preload IPC
├── 用户 Web（由在线模式启停）
└── 不启动管理员 Web

Headless / Web Admin
├── server-entry 单 Node 进程
├── adminApp :1250（始终启动）
├── userApp（由在线模式启停）
├── frpc（可选）
└── 浏览器通过 /api/admin/* 管理
```

两者不共享管理员登录状态：

- Electron 使用主进程内存 `AdminSession`。
- Web 使用独立 `admin_sessions` 表和 Cookie。

## 2. 进程与目录

```text
src/
├── core/         领域模型、服务、SQLite、安全
├── server/       用户 Web 的 Express 路由与中间件
├── admin-server/ Web Admin 的 Express 应用、路由、中间件
├── server-entry/ headless 启动、初始化 token、服务控制
├── main/         Electron 主进程、IPC、窗口、托盘
├── preload/      contextBridge
├── shared/       IPC 类型、共享模型、i18n、低层设置
admin/            管理前端（GUI + Web 共用）
web/              用户前端
tests/            单元/集成测试
installer/        WinSW + Inno Setup
```

运行数据：

| 形态 | 数据目录 |
|---|---|
| Electron | `%APPDATA%\cloudbox` |
| Headless | `%PROGRAMDATA%\CloudBox` |

Headless 目录布局：

```text
%PROGRAMDATA%\CloudBox\
├── cloudbox.db
├── ai-secret.key
├── config\
│   ├── admin-init-token.json
│   ├── ssl\
│   └── frpc.toml
├── storage\
├── plugins\
├── logs\
└── tmp\uploads\
```

## 3. Electron 入口

`src/main/index.ts`：

- 单实例锁
- 创建窗口/托盘
- `createMainContext()`
- 注册 IPC
- 启动用户 Web 和插件
- 退出时停止服务

`src/main/context.ts` 装配：

```text
SQLite
CoreServices
AdminUserService
AdminSession（内存）
TlsManager
CaManager
FrpService
ServerController
```

GUI 不创建 `adminApp`，不监听 1250。

`src/main/ipc.ts` 是 Electron 适配层：

- `isTrustedSender` 校验窗口与 `file://.../dist/admin/`
- Zod 输入校验
- 管理员 Session
- 调用 core/admin 服务
- 写入审计
- 返回 `Result<T>`

## 4. Headless / Web Admin 入口

`src/server-entry/index.ts`：

```text
createHeadlessController()
→ controller.start()
   ├── startAdmin()
   ├── startUser() if server.online
   └── frp.start() if frp.enabled
```

### 4.1 Headless context

`src/server-entry/context.ts` 创建：

- SQLite
- CoreServices
- AdminUserService
- AdminSessionRepository / AdminAuthService
- InitTokenService
- TlsManager / CaManager
- ServerController
- FrpService

### 4.2 ServiceController

`src/server-entry/serviceController.ts`：

- 固定管理端口 1250
- 启动前检查端口占用
- 用户端口不能等于 1250
- 管理 Web 先启动
- 用户 Web 后启动
- frp 最后启动
- 管理 Session 固定 4 小时
- 管理端每小时清理过期 `admin_sessions`
- Web 管理端可列出/全部注销管理会话

### 4.3 Admin app

`src/admin-server/app.ts`：

```text
Helmet（独立 CSP）
JSON 256KB
intranetOnly
/api/admin/app/info
/api/admin/health
/api/admin/auth/*
/api/admin/setup
/api/admin/users
/api/admin/settings
/api/admin/server
/api/admin/system
/api/admin/files
/api/admin/plugins
/api/admin/frp
/api/admin/ca
/api/admin/app/backup
dist/admin 静态资源 + SPA 回退
```

管理端和用户端不使用同一个 Express 实例。

## 5. 管理员认证与安全边界

### 5.1 初始化 token

无管理员时生成 32 字节随机 token：

- 只保存 SHA-256 哈希
- 24 小时有效
- 控制台/日志输出 `/setup?token=...`
- 建号后删除 token 文件
- 丢失后删除文件重启重新生成

### 5.2 管理员 Session

表 `admin_sessions`：

```text
id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at
```

管理员 Session TTL：`4 * 60 * 60 * 1000`，不读取用户 Web 的 `security.sessionTtlHours`。

Cookie：

```text
admin_sid   HttpOnly, SameSite=Strict, Secure when HTTPS
admin_csrf  非 HttpOnly, SameSite=Strict, Secure when HTTPS
```

### 5.3 内网限制

`createIntranetOnly` 直接读 socket 地址：

- 不信任 `X-Forwarded-For`
- 允许 loopback / RFC1918 / ULA / link-local
- 拒绝时返回 403 并写审计
- 可在设置中关闭，关闭需红色确认

注意：frp 本机连接会显示 loopback，因此 **1250 不应映射 frp**。

### 5.4 CSRF

管理端独立 double-submit：

- 登录后下发 `admin_csrf`
- 非 GET/HEAD/OPTIONS 必须 Cookie 与 `x-csrf-token` 一致
- 失败写审计

### 5.5 能力差异

Web Admin 通过浏览器文件流提供：

- 目录迁移（手动输入服务器绝对路径）
- 插件 ZIP 导入
- 证书/私钥上传
- CA 客户端证书下载
- 数据库备份下载

桌面原生文件选择器、开机自启和托盘仍仅 GUI 支持。管理 Web 没有内置 HTTPS，1250 不应映射 frp。

## 6. 用户 Web

`src/server/app.ts` 装配：

```text
Helmet / requestId / JSON 1MB
IPS
/health
全局 IP 守卫
基础限流
API 泛洪计数
Cap
公开配置/证书/插件主题
/api/admin（保留管理员命名空间守卫）
/api/hosting、/api/ai、/api/system
/api/plugins
文件、分享、认证、任务
插件 Web 资源、静态托管
SPA
错误处理
```

用户 Web 与管理员 Web 的 Session/Cookie/CSRF/CSP 完全分离。

## 7. 核心服务

`src/core/services/`：

- AuthService
- RegistrationService
- SecurityPolicyService
- FileService
- ExtractionService
- ScanService
- ShareService
- HostingService
- PluginService
- MailService
- SettingsService
- AuditService
- UpdateService

`src/core/services/admin/`：

- AdminUserService
- AdminAuthService
- AdminSettingsService
- AdminServerService
- AdminFrpService
- AdminCaService
- AdminLogService

Electron IPC 和 HTTP 路由只做适配，不直接实现业务规则。

## 8. 数据模型与迁移

迁移位于 `src/core/db/migrations/`，当前 014。

主要表：

```text
users, sessions, quotas, shares, file_scans, audit_logs,
plugins, settings, user_login_ips,
security_bans, security_policy_resets, security_policy_counts,
admin_sessions
```

`user_version` 和 `schema_migrations` 记录版本；未知高版本拒绝启动。

## 9. 安全策略引擎

策略存于 `settings.security.policy` JSON：

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

作用域：

```text
ip | account | global
```

时间语义：

- `0`：永久
- 空（内部 `-1`）：只计数，不封禁
- 正数：固定时长
- 可变：`base × 2^overflow`，受 max 限制

模式互斥：

- simple：旧版锁/IP 限流/注册/改名，不执行策略 JSON。
- advanced：策略卡 + IPS + API flood + 黑白名单，不执行旧锁。
- 切换模式清除封禁、计数、旧锁和内存限流。

全局计数达到阈值停止用户 Web；恢复期间手动启动会取消本轮自动恢复。

## 10. 文件、预览、解压与查杀

文件操作统一经过 safePath：

- 拒绝 `..`、绝对路径、UNC、控制字符、ADS、Windows 保留设备名
- 拒绝符号链接/Junction
- 路径段 255、相对路径 900

上传：

```text
busboy 单文件
→ 临时文件
→ 配额/大小/路径校验
→ 原子移动
→ 审计
```

预览：

- 图片/视频/音频/PDF 流式
- 文本 512KB 截断
- Office docx/xlsx/pptx 浏览器渲染
- 重度预览/单用户并发门，3 秒等待上限

解压：

- 最大 10000 文件
- 解压后总大小 50GB
- 7z 5 分钟超时
- 符号链接拒绝

查杀：

- VirusTotal API，>32MB 拒绝
- ClamAV 本地，>100MB 返回 skipped
- `--max-filesize` / `--max-scansize`
- infected 禁止下载/分享/解压

## 11. frp、HTTPS 与 CA

frp：

- 自动生成 `frpc.toml`
- TLS 到 frps
- TCP 支持 PROXY v2/tcpMux
- HTTP/HTTPS 保真实 IP
- 健康检查 3s/3 次/10s 默认

TLS：

- 最低 TLS 1.2
- mTLS 使用私有 CA

CA：

- node-forge/mkcert
- rootCA + server 证书
- 客户端 PKCS#12 密码 `changeit`
- 卸载只移除系统信任，不删文件

## 12. 插件运行时

```text
主进程 fork index.js
→ IPC 请求转发
→ {status, headers, body}
```

边界：

- manifest 名称 2–64，小写字母/数字/短横线
- ZIP 20MB、最多 2000 条目
- 启动 10s、请求 15s、停止 1s
- stdout/stderr 1000 行环形日志
- 插件是独立 Node 子进程，不是强 OS 沙箱
- adminUrl 无域名白名单

## 13. 前端与 AdminApi

`admin/src/api`：

```text
types.ts
electron.ts
http.ts
AdminApiContext.tsx
```

运行时：

```ts
const api = window.cloudbox
  ? new ElectronAdminApi()
  : new HttpAdminApi();
```

组件通过 `useAdminApi()` 获取，不直接访问 preload。

Web Admin 没有 Electron 文件选择器；相关操作隐藏或禁用。

## 13.1 自动更新

- `UpdateService` 解析 GitHub Release assets，GUI 选择 `CloudBox-Setup-*-x64.exe`，Server 选择 `CloudBox-Server-*-x64.exe`。
- `UpdateManager` 在后台下载到临时目录，按 asset 大小与 GitHub digest 校验，状态为 idle/checking/available/downloading/downloaded/installing/restarting/error。
- GUI 通过独立 cmd 脚本等待退出后静默运行安装包并重新启动 `CloudBox.exe`。
- Server 通过独立 cmd 脚本停止 WinSW 服务、静默运行 Server 安装包，再启动服务；当前进程以 0 退出，避免 WinSW 在安装前重启旧版本。
- Web 管理端通过 `/api/admin/system/update/status|download|install` 轮询状态；GUI 通过 IPC 轮询。
- 下载失败、大小不符或 digest 不符会删除临时文件并报告错误。

## 13.2 卸载数据选择

- NSIS `customUnInstall` 与 Inno Setup `InitializeUninstall` 在交互卸载时询问是否删除 `%APPDATA%\cloudbox` 与 `%PROGRAMDATA%\CloudBox`。
- 选择“否”只删除程序本体、快捷方式和注册表项。
- 静默安装/更新跳过询问，始终保留数据。
- 不再维护独立卸载工具，使用 Windows“应用和功能”/安装目录卸载入口。

## 14. 测试、构建与发布

```bash
npm run typecheck
npm test
npm run e2e:electron
npm run build:web
npm run build:admin
npm run build:headless
```

Windows：

```text
npm run dist:win           Electron 安装包/便携版
installer\build-server.ps1 Windows Server 服务安装包
```

Server 构建先由 `scripts/prepare-server-stage.mjs` 复制产物到 `release/server-stage`，执行 `npm prune --omit=dev` 裁剪依赖，再由 Inno Setup 编译；WinSW 已纳入 `installer/winsw/CloudBoxService.exe`。

Server 安装器：

- WinSW `CloudBoxService.exe` + `CloudBoxService.xml`
- `node.exe`
- `dist/headless/index.mjs`
- `dist/admin`
- `dist/web`
- `node_modules`
- `resources`

输出：

```text
release\CloudBox-Server-<version>-x64.exe
```

## 15. 已知限制

- 管理 Web 默认 HTTP，无内置 TLS。
- 1250 不应映射 frp。
- Web 端没有管理员登录失败锁定/TOTP/IP 白名单（按产品决策）。
- GUI 空闲锁定是前端计时器，服务端 Session 仍按 4 小时 TTL 有效。
- 管理 Web 没有内置 HTTPS；1250 不应映射 frp。
- 服务安装器未在实际干净 Windows Server 上完成安装/卸载回归。
- 首次安装用户 Web 默认离线。

---

---

# English

## CloudBox Architecture & Implementation

> Applies to version: 1.0.3

### Contents

```text
1. Runtime forms
2. Processes and directories
3. Electron entry
4. Headless / Web Admin entry
5. Admin authentication and security boundary
6. User Web
7. Core services
8. Data model and migrations
9. Security policy engine
10. Files, previews, extraction and scanning
11. frp, HTTPS and CA
12. Plugin runtime
13. Frontend and AdminApi
14. Tests, build and release
15. Known limitations
```

---

### 1. Runtime forms

CloudBox 1.0.3 has two runtime forms; they share core/services and SQLite, but their entry points and deployment differ.

```text
Electron GUI
├── main process
├── desktop window + preload IPC
├── user Web (started/stopped by online mode)
└── admin Web not started

Headless / Web Admin
├── server-entry single Node process
├── adminApp :1250 (always started)
├── userApp (started/stopped by online mode)
├── frpc (optional)
└── browser management via /api/admin/*
```

The two forms do not share admin login state:

- Electron uses an in-memory `AdminSession` in the main process.
- Web uses a separate `admin_sessions` table and cookies.

### 2. Processes and directories

```text
src/
├── core/          domain models, services, SQLite, security
├── server/        Express routes and middleware for the user Web
├── admin-server/  Express app, routes and middleware for Web Admin
├── server-entry/  headless startup, init token, service control
├── main/          Electron main process, IPC, windows, tray
├── preload/       contextBridge
├── shared/        IPC types, shared models, i18n, low-level settings
admin/             admin frontend (shared by GUI + Web)
web/               user frontend
tests/             unit/integration tests
installer/         WinSW + Inno Setup
```

Runtime data:

| Form | Data directory |
|---|---|
| Electron | `%APPDATA%\cloudbox` |
| Headless | `%PROGRAMDATA%\CloudBox` |

Headless directory layout:

```text
%PROGRAMDATA%\CloudBox\
├── cloudbox.db
├── ai-secret.key
├── config\
│   ├── admin-init-token.json
│   ├── ssl\
│   └── frpc.toml
├── storage\
├── plugins\
├── logs\
└── tmp\uploads\
```

### 3. Electron entry

`src/main/index.ts`:

- single-instance lock
- creates the window/tray
- `createMainContext()`
- registers IPC
- starts the user Web and plugins
- stops services on exit

`src/main/context.ts` assembles:

```text
SQLite
CoreServices
AdminUserService
AdminSession (in-memory)
TlsManager
CaManager
FrpService
ServerController
```

The GUI does not create `adminApp` and does not listen on 1250.

`src/main/ipc.ts` is the Electron adapter layer:

- `isTrustedSender` validates the window and `file://.../dist/admin/`
- Zod input validation
- admin session
- calls core/admin services
- writes audit entries
- returns `Result<T>`

### 4. Headless / Web Admin entry

`src/server-entry/index.ts`:

```text
createHeadlessController()
→ controller.start()
   ├── startAdmin()
   ├── startUser() if server.online
   └── frp.start() if frp.enabled
```

#### 4.1 Headless context

`src/server-entry/context.ts` creates:

- SQLite
- CoreServices
- AdminUserService
- AdminSessionRepository / AdminAuthService
- InitTokenService
- TlsManager / CaManager
- ServerController
- FrpService

#### 4.2 ServiceController

`src/server-entry/serviceController.ts`:

- fixed admin port 1250
- checks the port is free before starting
- the user port must not equal 1250
- admin Web starts first
- user Web starts afterwards
- frp starts last
- admin session fixed at 4 hours
- the admin side purges expired `admin_sessions` every hour
- Web Admin can list/revoke all admin sessions

#### 4.3 Admin app

`src/admin-server/app.ts`:

```text
Helmet (independent CSP)
JSON 256KB
intranetOnly
/api/admin/app/info
/api/admin/health
/api/admin/auth/*
/api/admin/setup
/api/admin/users
/api/admin/settings
/api/admin/server
/api/admin/system
/api/admin/files
/api/admin/plugins
/api/admin/frp
/api/admin/ca
/api/admin/app/backup
dist/admin static assets + SPA fallback
```

The admin side and the user side do not use the same Express instance.

### 5. Admin authentication and security boundary

#### 5.1 Initialization token

When there is no administrator, a 32-byte random token is generated:

- only the SHA-256 hash is stored
- valid for 24 hours
- prints `/setup?token=...` to the console/log
- the token file is deleted after the account is created
- if lost, delete the file and restart to regenerate

#### 5.2 Admin session

Table `admin_sessions`:

```text
id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at
```

Admin session TTL is `4 * 60 * 60 * 1000`; the user Web's `security.sessionTtlHours` is not read.

Cookies:

```text
admin_sid   HttpOnly, SameSite=Strict, Secure when HTTPS
admin_csrf  not HttpOnly, SameSite=Strict, Secure when HTTPS
```

#### 5.3 Intranet restriction

`createIntranetOnly` reads the socket address directly:

- does not trust `X-Forwarded-For`
- allows loopback / RFC1918 / ULA / link-local
- returns 403 and writes an audit entry when rejected
- can be disabled in settings; disabling requires a red confirmation

Note: frp connections from the local machine appear as loopback, so **1250 should not be mapped through frp**.

#### 5.4 CSRF

The admin side uses an independent double-submit:

- `admin_csrf` is issued after login
- non-GET/HEAD/OPTIONS requests require the cookie to match `x-csrf-token`
- failures are audited

#### 5.5 Capability differences

Web Admin provides the following through browser file streams:

- directory migration (enter the server absolute path manually)
- plugin ZIP import
- certificate/private key upload
- CA client certificate download
- database backup download

Native desktop file pickers, launch at startup and the tray are still GUI-only. Admin Web has no built-in HTTPS, and 1250 should not be mapped through frp.

### 6. User Web

`src/server/app.ts` assembles:

```text
Helmet / requestId / JSON 1MB
IPS
/health
global IP guard
basic rate limiting
API flood counting
Cap
public config/certificates/plugin themes
/api/admin (keeps the admin namespace guard)
/api/hosting, /api/ai, /api/system
/api/plugins
files, shares, authentication, tasks
plugin Web assets, static hosting
SPA
error handling
```

User Web and admin Web have completely separate session/cookie/CSRF/CSP.

### 7. Core services

`src/core/services/`:

- AuthService
- RegistrationService
- SecurityPolicyService
- FileService
- ExtractionService
- ScanService
- ShareService
- HostingService
- PluginService
- MailService
- SettingsService
- AuditService
- UpdateService

`src/core/services/admin/`:

- AdminUserService
- AdminAuthService
- AdminSettingsService
- AdminServerService
- AdminFrpService
- AdminCaService
- AdminLogService

Electron IPC and HTTP routes only adapt; they do not implement business rules directly.

### 8. Data model and migrations

Migrations live in `src/core/db/migrations/`; the latest is 014.

Main tables:

```text
users, sessions, quotas, shares, file_scans, audit_logs,
plugins, settings, user_login_ips,
security_bans, security_policy_resets, security_policy_counts,
admin_sessions
```

`user_version` and `schema_migrations` record the version; an unknown higher version refuses to start.

### 9. Security policy engine

The policy is stored in the `settings.security.policy` JSON:

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

Scopes:

```text
ip | account | global
```

Time semantics:

- `0`: permanent
- empty (internally `-1`): count only, do not ban
- positive number: fixed duration
- variable: `base × 2^overflow`, capped by max

Modes are mutually exclusive:

- simple: legacy lock/IP rate limiting/registration/rename; the policy JSON is not enforced.
- advanced: policy cards + IPS + API flood + allow/deny lists; legacy locks are not enforced.
- switching modes clears bans, counters, legacy locks and in-memory rate limits.

When the global counter reaches the threshold, the user Web stops; manually starting it during recovery cancels that round of automatic recovery.

### 10. Files, previews, extraction and scanning

File operations all go through safePath:

- rejects `..`, absolute paths, UNC, control characters, ADS and Windows reserved device names
- rejects symbolic links/Junctions
- path segment 255, relative path 900

Upload:

```text
busboy single file
→ temp file
→ quota/size/path validation
→ atomic move
→ audit
```

Preview:

- streaming for images/videos/audio/PDF
- text truncated at 512KB
- Office docx/xlsx/pptx rendered in the browser
- heavy preview/per-user concurrency gate, 3-second wait cap

Extraction:

- max 10000 files
- 50GB total size after extraction
- 7z 5-minute timeout
- symbolic links rejected

Scanning:

- VirusTotal API; files >32MB rejected
- local ClamAV; returns skipped for >100MB
- `--max-filesize` / `--max-scansize`
- infected files cannot be downloaded/shared/extracted

### 11. frp, HTTPS and CA

frp:

- auto-generates `frpc.toml`
- TLS to frps
- TCP supports PROXY v2/tcpMux
- HTTP/HTTPS preserves the real IP
- health check 3s/3 attempts/10s by default

TLS:

- minimum TLS 1.2
- mTLS uses the private CA

CA:

- node-forge/mkcert
- rootCA + server certificate
- client PKCS#12 password `changeit`
- uninstall only removes system trust, does not delete files

### 12. Plugin runtime

```text
main process forks index.js
→ IPC request forwarding
→ {status, headers, body}
```

Boundaries:

- manifest name 2–64, lowercase letters/digits/hyphens
- ZIP 20MB, at most 2000 entries
- start 10s, request 15s, stop 1s
- 1000-line ring log for stdout/stderr
- plugins are separate Node child processes, not a strong OS sandbox
- adminUrl has no domain allowlist

### 13. Frontend and AdminApi

`admin/src/api`:

```text
types.ts
electron.ts
http.ts
AdminApiContext.tsx
```

At runtime:

```ts
const api = window.cloudbox
  ? new ElectronAdminApi()
  : new HttpAdminApi();
```

Components obtain it through `useAdminApi()` and do not access preload directly.

Web Admin has no Electron file picker; related operations are hidden or disabled.

### 13.1 Automatic updates

- `UpdateService` parses GitHub Release assets: the GUI selects `CloudBox-Setup-*-x64.exe` and the Server selects `CloudBox-Server-*-x64.exe`.
- `UpdateManager` downloads in the background to a temp directory, verifies against the asset size and GitHub digest, with states idle/checking/available/downloading/downloaded/installing/restarting/error.
- The GUI uses a separate cmd script that waits for exit, then silently runs the installer and restarts `CloudBox.exe`.
- The Server uses a separate cmd script that stops the WinSW service, silently runs the Server installer, and then starts the service; the current process exits with 0 so WinSW does not restart the old version before installation.
- Web Admin polls status via `/api/admin/system/update/status|download|install`; the GUI polls via IPC.
- If the download fails, or the size or digest does not match, the temp file is deleted and an error is reported.

### 13.2 Uninstall data selection

- NSIS `customUnInstall` and Inno Setup `InitializeUninstall` ask during interactive uninstall whether to delete `%APPDATA%\cloudbox` and `%PROGRAMDATA%\CloudBox`.
- Choosing "No" only removes the program itself, shortcuts and registry entries.
- Silent install/update skips the prompt and always keeps the data.
- There is no longer a separate uninstall tool; use the Windows "Apps and features" / installation directory uninstall entry.

### 14. Tests, build and release

```bash
npm run typecheck
npm test
npm run e2e:electron
npm run build:web
npm run build:admin
npm run build:headless
```

Windows:

```text
npm run dist:win           Electron installer/portable build
installer\build-server.ps1 Windows Server service installer
```

The Server build first uses `scripts/prepare-server-stage.mjs` to copy the artifacts to `release/server-stage`, runs `npm prune --omit=dev` to trim dependencies, then compiles with Inno Setup; WinSW is already included at `installer/winsw/CloudBoxService.exe`.

Server installer:

- WinSW `CloudBoxService.exe` + `CloudBoxService.xml`
- `node.exe`
- `dist/headless/index.mjs`
- `dist/admin`
- `dist/web`
- `node_modules`
- `resources`

Output:

```text
release\CloudBox-Server-<version>-x64.exe
```

### 15. Known limitations

- Admin Web is HTTP by default with no built-in TLS.
- 1250 should not be mapped through frp.
- The Web side has no admin login-failure lockout/TOTP/IP allowlist (a product decision).
- GUI idle locking is a frontend timer; server-side sessions remain valid for the 4-hour TTL.
- Admin Web has no built-in HTTPS; 1250 should not be mapped through frp.
- The service installer has not completed install/uninstall regression on an actual clean Windows Server.
- On first install, the user Web is offline by default.
