# CloudBox Linux CLI v1.0.0

CloudBox Linux 是无头命令行版本，不包含 Electron、Chromium 或管理员 GUI；保留核心网盘后端和 Web 用户端。

## 部署指南

### 环境要求

- Linux x86_64
- Node.js >= 22.18
- 可选：ClamAV（`/usr/bin/clamscan`）
- 可选：frpc（内网穿透，放入 PATH 或 `resources/bin/frpc`）
- 可选：7za（压缩包已提供 `resources/bin/7za`）

### 安装

```bash
tar -xzf cloudbox-linux-0.1.0.tar.gz
cd cloudbox-linux-0.1.0
sudo bash install.sh
```

安装脚本会：

1. 创建 `cloudbox` 系统用户
2. 部署到 `/opt/cloudbox`
3. 创建 `/var/lib/cloudbox`
4. 安装生产依赖
5. 注册并启动 `cloudbox.service`

### 手动运行

```bash
cd source
npm install
node src/cli/index.ts init
node src/cli/index.ts start
```

便携模式（数据写入当前目录 `./data`）：

```bash
node src/cli/index.ts --portable start
```

默认监听 `0.0.0.0:8686`，Web 用户端使用 `dist/web`。

## 指令大全

```text
cloudbox start [--portable] [--port <port>] [--host <host>]
cloudbox init [--username <name>] [--password <password>]
cloudbox config get [key]
cloudbox config set <port|host> <value>
cloudbox reset-admin [--password <password>]
cloudbox plugin list
cloudbox plugin enable <name>
cloudbox plugin disable <name>
```

示例：

```bash
cloudbox init --username admin
cloudbox start --portable --port 8686
cloudbox config set port 9000
cloudbox reset-admin
cloudbox plugin list
```

## 功能差异说明

Linux CLI 保留：

- SQLite、用户/配额、文件上传下载、预览与 Range
- 分享、解压、ClamAV 查杀、AI、MCP
- 插件子进程、静态托管、邮件告警
- Web 用户端

Linux CLI 不包含：

- Electron 管理员 GUI
- 私有 CA / HTTPS / mTLS 管理
- frp 可视化配置与启动管理（仅提供 `frpc` 解析）
- 可视化目录迁移
- 完整的邮件/AI/MCP/托管/权限设置 CLI（目前 `config` 仅支持 port/host）

需要 HTTPS 时，建议使用 Nginx/Caddy 反向代理。

## 致谢与开源协议

CloudBox Linux 使用了以下开源项目：

- **frp**：内网穿透与 HTTP/HTTPS 隧道，Apache-2.0；通过独立 `frpc` 进程调用，未修改源码。
- **ClamAV**：本地病毒扫描，GPLv2；调用系统 `/usr/bin/clamscan`，未修改源码。
- **7-Zip / 7za**：压缩包解压，LGPL-2.1+（含 unRAR 限制条款）；通过独立 `7za` 进程调用，未修改源码。
- Node.js、Express、better-sqlite3、i18next、MCP SDK 等，详见完整清单。

完整组件与许可证信息见：

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

Linux 发布包不包含 Electron 与 Chromium；7za 以独立二进制形式分发，未与 CloudBox 源码合并。

---

## 完整功能与实现机制（补充）

### 账号、会话与安全

- 密码使用 **scrypt** 哈希（N=32768），数据库中不保存明文密码。
- 登录会话使用随机会话令牌；数据库只保存令牌的 SHA-256 哈希，浏览器使用 `HttpOnly`、`SameSite=Lax` Cookie。
- 默认会话有效期 `security.sessionTtlHours = 168` 小时；`last_seen` 每 60 秒最多更新一次，降低数据库写入。
- 非 GET/HEAD 请求要求 CSRF Token；CSRF Cookie 与 Session Cookie 分离。
- **登录失败锁定按账号计数，不是按 IP**：默认连续失败 **5 次**后锁定。第 5 次起锁定 60 秒，之后按 `60s × 2^(失败次数-5)` 指数增长，最长 60 分钟。
- 管理员 GUI 的“用户管理”提供 **快速解锁**：清除该账号的 `failed_attempts` 与 `locked_until`，无需等待锁定到期；用户密码重置、禁用账号、会话撤销也在管理端完成。
- 账号不存在时仍执行一次 scrypt 校验，降低通过响应时间枚举用户名的风险。
- IP 维度另有独立限流：登录 30 次/15 分钟/IP；全部 API 600 次/分钟/IP；上传 120 次/分钟/IP；注册 2 次/小时/IP；分享创建 10 次/分钟/用户；分享下载 60 次/分钟/IP+Token；解压/查杀 10 次/分钟/用户。
- 限流触发返回 429，并可发送 `security.alert` 邮件告警；可选信任 `X-Forwarded-For`（仅建议在 frp/Nginx 反向代理后开启）。
- 安全审计记录登录成功/失败/锁定、退出、会话轮换/撤销、管理员重置密码、用户禁用/解锁、插件启停、托管变更、邮件设置变更等操作。
- 文件路径统一经过 `safePath` 校验；拒绝 `..`、绝对路径、符号链接逃逸；上传临时目录、配额和文件大小均受限。
- 默认单文件上限 2 GB；所有上传通过 busboy 流式处理，不把完整文件读入内存。

### 文件、预览与分享

- 本地多用户网盘：目录、上传、下载、重命名、删除、配额、用量统计。
- 图片/视频/PDF/文本预览；音频支持 MP3/WAV/OGG/FLAC/AAC/M4A。
- 预览接口使用服务端 MIME 白名单与文件魔数校验；HTML/SVG 等主动内容不内联执行。
- 下载/预览支持单段 HTTP Range，返回 206、`Content-Range`、`Accept-Ranges`，可拖动播放进度。
- 文件分享使用随机 Token，可设置有效期；公开分享接口与登录态分享接口分离。
- 7za 解压 zip / 7z / rar / tar.gz；对压缩包条目逐条做路径校验，阻止 zip-slip；解压计入配额。
- ClamAV 本地查杀与 VirusTotal API 查杀；VirusTotal 文件上限 32 MB；infected 文件强制禁止下载、分享和解压。
- 音频播放器：全局 Zustand 状态、当前目录自动播放列表、上一首/下一首、进度/音量、切换目录不中断；媒体流按 Range 读取，不整首载入内存。

### 权限与用户

- 管理员可开关：图片预览、视频预览、PDF 预览、在线解压、安全查杀。
- 关闭权限后 Web 端隐藏入口，后端接口同时返回 403，不能通过直接调用绕过。
- 用户角色：管理员/普通用户；状态：正常/禁用；配额可为 null（不限量）。
- 用户可自助注册（可开关，默认关闭）；注册限流 2 次/小时/IP，默认分配 5 GB 配额。
- 用户可在 Web Header 点击头像上传 PNG/JPEG/WebP（最大 600 KB）；头像以 data URL 保存到 `users.avatar_data`，管理端用户列表显示缩略图。

### AI 与 MCP

- 原生 AI 助手兼容 OpenAI 风格 Chat Completions，支持 Function Calling / ReAct 工具循环。
- AI 模式：管理员共享 Key 或用户自填 Key；API Key 使用 AES-256-GCM 加密落盘，界面只显示脱敏值。
- 每日请求上限默认 50；工作范围可选“仅指定文件夹”或“全盘”（高危），高危工具调用需要用户确认。
- AI 工具的文件路径同样经过网盘相对路径和 safePath 校验，不能访问宿主机绝对路径。
- 中英文界面切换时，英文请求会在 System Prompt 追加 “Please reply to the user in English.”。
- 原生 MCP Server 使用 Streamable HTTP，端点 `/api/mcp`，Bearer Token 鉴权，可绑定一个网盘用户；支持文件列表、读取、写入、搜索等工具（以实际工具注册表为准）。

### 插件平台

- 插件在 `child_process.fork` 独立子进程中运行；主进程不 `require` 插件代码。
- 子进程环境变量最小化；主进程与插件通过 IPC 转发 HTTP 请求、事件与日志。
- 插件 `manifest.json` 定义名称/版本；`index.js` 导出 `activate(ctx)`。
- `ctx` 提供 `createRouter/registerRouter`、`on` 事件、`storage` 私有存储、`logger`、`manifest`。
- 插件管理端 UI 以 `sandbox="allow-scripts allow-forms"` iframe 加载；支持 `web-theme.css` 注入与 `web-override/` 接管 Web 首页。
- 插件导入 ZIP 时逐条校验路径，拒绝 `../` 和绝对路径；启用/禁用/接管/卸载写审计日志。
- 导入默认禁用；插件异常返回 `PLUGIN_ERROR`，不会让主服务崩溃。

### 静态托管、TLS 与 frp

- 静态站点挂载在 `/host/:username/*`，支持 public/private 可见性；private 站点必须登录。
- 托管读取经过 safePath 校验，CSP sandbox；SPA fallback 到 `index.html`。
- 私有 CA 通过 mkcert 生成；服务端证书位于 `config/ssl/server/`，CA 位于 `config/ssl/ca/`；支持 HTTPS 与 mTLS。
- 登录页在 HTTPS 且 CA 可用时显示根证书下载入口；客户端未信任 CA 时需先在浏览器中继续访问或导入根证书。
- mTLS 开启后客户端必须先有客户端证书，否则 TLS 握手阶段就会失败，登录页无法作为首次证书引导入口。
- frp 支持 TCP/HTTP/HTTPS 隧道；配置包含 `serverAddr/serverPort`、`auth.method/auth.token`、官方格式要求的顶层 `user`、`[transport] protocol=tcp` 与 `[transport.tls] enable=true`。
- frp 日志保存在管理端内存环形缓冲，GUI 网络设置实时查看；TCP 可选 PROXY protocol v2，但 Express 默认不解析该协议，建议 HTTP/HTTPS 隧道。

### 邮件、通知与运维

- SMTP 通过 nodemailer 异步发送，不阻塞主线程；密码使用 AES-256-GCM 加密，界面脱敏。
- 支持新用户注册、安全告警（账号锁定/IP 限流）、系统错误三类事件；同类事件 60 秒冷却，失败只写日志不抛出。
- 管理端可发送测试邮件。
- 支持数据库在线备份、数据/存储/插件目录迁移；迁移前校验目标路径并重启应用。
- Windows 卸载工具支持默认/自定义数据目录、程序本体、快捷方式、注册表卸载项/软件项/启动项；启动申请管理员权限，支持中文/English。
- 中英文 i18n：`zh-CN` / `en-US`，语言偏好存 `localStorage`，默认按 `navigator.language` 识别。

### 默认路径

- Windows 默认数据目录：`%APPDATA%\cloudbox`
  - `cloudbox.db`、`storage/`、`plugins/`、`config/`、`tmp/`
  - `config/ssl/`、`config/frpc.toml`
- Windows 默认缓存目录：`%LOCALAPPDATA%\cloudbox`
- Linux 系统模式：`/var/lib/cloudbox`
- Linux `--portable`：当前目录 `./data`

## 近期重要变更

- 管理端侧边栏不再显示监听端口，改为实时显示上传/下载速率（2 秒采样，基于服务端累计收发字节）。
- 修复空文件夹部署误报“路径不存在”：现在先校验目录，缺少 `index.html` 时明确提示；部署路径统一为不带前导斜杠的相对路径。
- 管理端“登录失败保护”新增开关与可配置项：账号失败阈值、首次/最长锁定分钟、IP 登录请求上限与统计窗口；默认值与旧行为一致（5 次、1/60 分钟、30 次/15 分钟），手动解锁保持独立。
- PROXY protocol v2 选项已移除；原位置改为 frp 同源 IP 风险提示，避免误伤同一 frp 后的其他用户。
- 静态托管支持 TCP 端口映射：可直接使用 `https://公网IP:映射端口/` 作为公网基础地址；TCP 不携带真实客户端 IP。HTTP/HTTPS 隧道仍推荐用于域名、`locations` 和真实 IP。
- **PROXY protocol v2 当前未适配**：Express/HTTPS 前端不会解析 PROXY v2 头。开启后 frpc 会把 PROXY 头直接发给 HTTPS 监听器，导致 TLS 握手/请求失败。当前版本已禁用该选项并停止生成 `transport.proxyProtocolVersion`；这不是 frps 的问题，而是本地前端未实现 PROXY v2 解析。建议使用 HTTP/HTTPS 隧道，或在未来版本加入 PROXY 前端适配。
- 私有 CA 一键签发服务端证书时新增“包含的域名或 IP（多个用英文逗号分隔）”。会动态追加到 mkcert SAN，并始终保留 `localhost`、`127.0.0.1`、`::1`、本机 hostname 和本机局域网 IP；根 CA 不变。
- Web 文件页补齐英文：标题、面包屑、上传/刷新/删除、表头、空状态、操作提示和存储空间等；管理端状态栏保持中英文显示正确。

# CloudBox Linux CLI v1.0.0 — English

CloudBox Linux is a headless command-line edition. It does not include Electron, Chromium or the administrator GUI; it retains the core drive backend and web client.

## Deployment Guide

### Requirements

- Linux x86_64
- Node.js >= 22.18
- Optional: ClamAV (`/usr/bin/clamscan`)
- Optional: frpc (NAT traversal; place it in PATH or `resources/bin/frpc`)
- Optional: 7za (the archive includes `resources/bin/7za`)

### Installation

```bash
tar -xzf cloudbox-linux-0.1.0.tar.gz
cd cloudbox-linux-0.1.0
sudo bash install.sh
```

The installer will:

1. Create the `cloudbox` system user
2. Deploy to `/opt/cloudbox`
3. Create `/var/lib/cloudbox`
4. Install production dependencies
5. Register and start `cloudbox.service`

### Manual Run

```bash
cd source
npm install
node src/cli/index.ts init
node src/cli/index.ts start
```

Portable mode (data in `./data` under the current directory):

```bash
node src/cli/index.ts --portable start
```

The server listens on `0.0.0.0:8686` by default and serves the web client from `dist/web`.

## Command Reference

```text
cloudbox start [--portable] [--port <port>] [--host <host>]
cloudbox init [--username <name>] [--password <password>]
cloudbox config get [key]
cloudbox config set <port|host> <value>
cloudbox reset-admin [--password <password>]
cloudbox plugin list
cloudbox plugin enable <name>
cloudbox plugin disable <name>
```

Examples:

```bash
cloudbox init --username admin
cloudbox start --portable --port 8686
cloudbox config set port 9000
cloudbox reset-admin
cloudbox plugin list
```

## Feature Differences

The Linux CLI includes:

- SQLite, users/quotas, file upload/download, previews and HTTP Range
- Sharing, archive extraction, ClamAV scanning, AI and MCP
- Plugin child processes, static hosting and email alerts
- Web client

The Linux CLI does not include:

- The Electron administrator GUI
- Private CA / HTTPS / mTLS management
- Visual frp configuration and process management (only `frpc` binary resolution is provided)
- Visual data-directory migration
- Complete CLI settings for email/AI/MCP/hosting/permissions (currently `config` supports only port and host)

For HTTPS, use an Nginx or Caddy reverse proxy.

## Acknowledgments and Open Source Licenses

CloudBox Linux uses the following open-source projects:

- **frp**: NAT traversal and HTTP/HTTPS tunnels, Apache-2.0; invoked as a separate `frpc` process without source modifications.
- **ClamAV**: local antivirus scanning, GPLv2; invoked as the system `/usr/bin/clamscan` without source modifications.
- **7-Zip / 7za**: archive extraction, LGPL-2.1+ (including the unRAR restriction); invoked as a separate `7za` process without source modifications.
- Node.js, Express, better-sqlite3, i18next, the MCP SDK and others are listed in the full inventory.

See the complete component and license information here:

[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)

The Linux release does not include Electron or Chromium. 7za is distributed as a separate binary and is not merged with CloudBox source code.

## Complete Features & Mechanisms (English)

### Accounts, Sessions and Security

- Passwords use **scrypt** hashing (N=32768); plaintext passwords are never stored.
- Login sessions use random tokens; only SHA-256 token hashes are stored. The browser cookie is `HttpOnly` and `SameSite=Lax`.
- Default session TTL is `security.sessionTtlHours = 168` hours. `last_seen` is updated at most once every 60 seconds.
- Non-GET/HEAD requests require a CSRF token; the CSRF cookie is separate from the session cookie.
- **Login failure locking is account-based, not IP-based**: after **5 consecutive failures**, the account is locked. The first lock is 60 seconds; subsequent locks grow as `60s × 2^(failures-5)` up to 60 minutes.
- The administrator GUI provides **quick unlock** in Users: it clears `failed_attempts` and `locked_until` immediately. Password reset, disable and session revocation are also available there.
- A dummy scrypt verification runs for unknown usernames to reduce timing-based account enumeration.
- Independent IP rate limits: login 30/15 min/IP; all APIs 600/min/IP; uploads 120/min/IP; registration 2/hour/IP; share creation 10/min/user; share download 60/min/IP+token; extraction/scan 10/min/user.
- Rate limiting returns 429 and can emit a `security.alert` email. `X-Forwarded-For` trust is optional and should be enabled only behind frp/Nginx.
- Audit logs cover login success/failure/lock, logout, session rotation/revocation, admin password reset, user disable/unlock, plugin changes, hosting changes and mail settings changes.
- All paths pass `safePath` validation, rejecting `..`, absolute paths and symlink escapes. Upload temporary storage, quotas and file size are bounded.
- Default single-file limit is 2 GB; uploads stream through busboy and are not loaded fully into memory.

### Files, Previews and Sharing

- Local multi-user drive with folders, upload, download, rename, delete, quotas and usage.
- Image, video, PDF and text previews; audio supports MP3/WAV/OGG/FLAC/AAC/M4A.
- Preview MIME whitelists and magic-byte checks are enforced; active HTML/SVG is not rendered inline.
- Downloads and previews support single HTTP Range requests with 206, `Content-Range` and `Accept-Ranges`.
- Share links use random tokens and optional expiry; public and authenticated share routes are separate.
- 7za extracts zip / 7z / rar / tar.gz with per-entry path validation and zip-slip protection; extraction counts toward quotas.
- ClamAV local scanning and VirusTotal API scanning (32 MB VirusTotal limit); infected files are blocked from download, sharing and extraction.
- Global audio player with Zustand state, current-folder playlist, previous/next, seek, volume and navigation persistence; media streams by Range rather than loading the whole track.

### Permissions and Users

- Administrators can toggle image preview, video preview, PDF preview, extraction and security scanning.
- Disabled features are hidden in the web UI and the backend also returns 403.
- Roles: administrator/user; status: active/disabled; quota can be null (unlimited).
- Optional public registration (default off), limited to 2 registrations/hour/IP and 5 GB default quota.
- Users can upload a PNG/JPEG/WebP avatar (max 600 KB) from the web header. It is stored as a data URL in `users.avatar_data`; the admin user list shows a thumbnail.

### AI and MCP

- Native AI assistant compatible with OpenAI-style Chat Completions, Function Calling and a ReAct tool loop.
- AI modes: administrator-shared key or user-supplied key. API keys are AES-256-GCM encrypted and masked in the UI.
- Default daily limit is 50. Work scope can be a specific folder or the entire drive (high risk); high-risk tool calls require confirmation.
- AI tool paths use the same relative-path and safePath checks; host absolute paths are rejected.
- When the UI is English, the system prompt appends “Please reply to the user in English.”
- Native MCP server uses Streamable HTTP at `/api/mcp`, Bearer-token authentication and an optional bound CloudBox user. Available tools follow the registered tool set (file listing, reading, writing, search, etc.).

### Plugin Platform

- Plugins run in isolated `child_process.fork` processes; the main process never `require`s plugin code.
- Child environment variables are minimized; HTTP requests, events and logs cross an IPC boundary.
- `manifest.json` defines name/version; `index.js` exports `activate(ctx)`.
- `ctx` exposes router creation, events, private storage, logger and manifest.
- Admin plugin UIs load in a sandboxed iframe (`allow-scripts allow-forms`); plugins can inject `web-theme.css` or take over the web UI via `web-override/`.
- ZIP imports validate every path and reject `../` and absolute paths. Enable/disable/takeover/uninstall are audited.
- Imports are disabled by default. Plugin errors return `PLUGIN_ERROR` without crashing the main service.

### Static Hosting, TLS and frp

- Static sites are served at `/host/:username/*` with public/private visibility; private sites require login.
- Hosting reads use safePath and a sandbox CSP; SPAs fall back to `index.html`.
- Private CA is generated with mkcert. Server certificates live in `config/ssl/server/` and CA files in `config/ssl/ca/`; HTTPS and mTLS are supported.
- When HTTPS is enabled and the CA exists, the login page exposes a root-certificate download link. Clients that do not trust the CA must bypass the warning first or install the CA.
- With mTLS enabled, clients must present a client certificate before the TLS handshake completes, so the login page cannot serve as the first certificate bootstrap.
- frp supports TCP/HTTP/HTTPS tunnels. Config includes `serverAddr/serverPort`, `auth.method/auth.token`, the official top-level `user`, `[transport] protocol=tcp` and `[transport.tls] enable=true`.
- frpc output is kept in an in-memory ring buffer and shown live in the admin network page. TCP PROXY protocol v2 is optional, but Express does not parse it by default; HTTP/HTTPS tunnels are recommended.

### Email, Notifications and Operations

- SMTP uses nodemailer asynchronously; the main thread is never blocked. Passwords are AES-256-GCM encrypted and masked.
- Events: new registration, security alert (account lock/IP rate limit) and system error. Identical alerts have a 60-second cooldown; failures are logged only.
- Administrators can send a test email.
- Online database backup and data/storage/plugin directory migration are supported; target paths are validated and the app restarts after migration.
- The Windows uninstaller supports default/custom data folders, program files, shortcuts, uninstall/software/startup registry entries; it requests administrator rights and supports Chinese/English.
- i18n: `zh-CN` / `en-US`, stored in `localStorage`, detected from `navigator.language` by default.

### Default Paths

- Windows data: `%APPDATA%\cloudbox`
  - `cloudbox.db`, `storage/`, `plugins/`, `config/`, `tmp/`
  - `config/ssl/`, `config/frpc.toml`
- Windows cache: `%LOCALAPPDATA%\cloudbox`
- Linux system mode: `/var/lib/cloudbox`
- Linux `--portable`: `./data`

## Recent Changes

- The admin sidebar no longer displays the listening port; it now shows real-time upload/download rates (sampled every 2 seconds from server byte counters).
- Fixed the misleading “path does not exist” error for empty folders: the directory is validated first and a missing `index.html` is reported explicitly; deploy paths are normalized to relative paths without a leading slash.
- Added a “Login failure protection” switch with configurable account threshold, initial/max lock minutes, IP login request limit and window; defaults preserve the old behavior (5 failures, 1/60 minutes, 30 requests/15 minutes). Manual unlock remains independent.
- Removed the PROXY protocol v2 option; its position now explains the frp shared-IP risk to avoid blocking other users behind the same frp endpoint.
- Static hosting supports TCP port mapping: use `https://public-ip:mapped-port/` as the public base URL. TCP does not carry the real client IP. HTTP/HTTPS tunnels remain recommended for domains, `locations` and real client IPs.
- **PROXY protocol v2 is not adapted yet**: the Express/HTTPS frontend does not parse PROXY v2 headers. Enabling it sends the PROXY header directly to the HTTPS listener and breaks the TLS handshake/request. The option is now disabled and `transport.proxyProtocolVersion` is no longer generated. This is a local frontend limitation, not an frps problem. Use HTTP/HTTPS tunnels, or add a PROXY-aware frontend in a future release.
- One-click private CA server-certificate issuance now accepts “Included domains or IPs (comma-separated)”. Values are appended to the mkcert SAN; `localhost`, `127.0.0.1`, `::1`, the hostname and LAN IPs are always included. The root CA is unchanged.
- The web file page now has complete English labels for title, breadcrumbs, upload/refresh/delete, table headers, empty state, action titles and storage. Admin status text remains correct in both languages.
