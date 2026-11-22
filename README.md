# CloudBox

CloudBox 是一个运行在 Windows 本机/服务器上的私有网盘与文件管理服务。文件保存在自己的电脑或服务器上，局域网用户通过浏览器访问；需要公网访问时可配置 frp。

当前版本：**1.0.2**

CloudBox 提供两种运行形态，二者共用同一套用户、文件、安全策略和数据库，但管理入口与部署方式不同。

| | Electron GUI 版 | Web 管理版（headless） |
|---|---|---|
| 适用场景 | 个人电脑、单机桌面 | Windows Server、长期运行的服务 |
| 管理入口 | Electron 桌面窗口 | 浏览器 `http://<内网IP>:1250` |
| 管理员登录 | 桌面首次向导 + GUI 登录 | `/setup?token=...` 初始化，再登录 1250 |
| 数据目录 | `%APPDATA%\cloudbox` | `%PROGRAMDATA%\CloudBox` |
| 安装方式 | NSIS 安装包 / 便携版 | WinSW + Inno Setup 服务安装包 |
| 用户 Web | 由 GUI「在线模式」启停 | 管理 Web 始终开启，用户 Web 由在线开关控制 |
| 桌面专属能力 | 原生文件选择器、开机自启/托盘 | 目录迁移改为绝对路径输入；证书、插件、CA 导出改用浏览器文件流 |

> Web 管理端的 1250 端口默认仅允许内网访问。**不要把 1250 映射到 frp 或公网端口转发**；frp 只应映射用户 Web 端口。

## 功能亮点

### 两种管理形态

- **Electron GUI**：服务状态、端口、HTTPS、frp、用户、文件、插件、安全策略、日志全部图形化。
- **Web 管理端**：独立 1250 管理服务，支持内网浏览器管理、初始化 token、独立 Session/CSRF、4 小时管理会话、Session 列表/全部注销、日志、用户、设置、frp、CA、目录迁移、插件 ZIP 导入和数据库备份下载。
- 两个入口共用同一套 `admin/src` 页面和 `core/services` 业务层；Web 版通过 `/api/admin/*`，GUI 通过 Electron IPC。
- GUI 默认离线启动，避免安装后自动监听端口；Web 管理端始终启动，用户 Web 由「在线模式」控制。

### 文件与预览

- 多用户、独立存储目录、容量配额。
- 上传、下载、移动、复制、重命名、删除、文件夹管理。
- 图片、视频、音频、PDF、Word、Excel、PPT、文本/代码在线预览。
- 多文件上传队列（默认最多 10 个并发）。
- 分享直链与有效期。
- 静态站点托管到 `/host/`，与主站 API 隔离。

### frp 内网穿透

- 在 GUI 或 Web 管理端填写 frps 地址、端口、token、用户名、隧道类型和公网映射。
- HTTP / HTTPS / TCP 隧道。
- HTTP/HTTPS 保留真实客户端 IP；TCP 支持 PROXY Protocol v2。
- TCP 可启用 `tcpMux`，健康检查与业务流量共用 TCP。
- 自动生成 frpc 配置，支持启动、停止、重启和日志查看。
- **frp 只映射用户 Web；管理 Web 1250 不应映射。**

### 一键 CA 与 HTTPS

- 私有 CA 创建、安装到系统信任库、导出客户端证书。
- 导入证书/私钥，在线切换 HTTPS。
- mTLS 客户端证书。
- 网络变更失败回滚，避免服务不可用。

### 网络安全

- **简洁模式**：旧版账号锁定、IP 登录限流、改名限制、注册限制，适合新用户。
- **高级模式**：拖拽式策略卡，支持 IP / 账户 / 全局三种作用域。
- 可选策略：登录失败、注册量、改名、Cap、同时在线人数、历史 IP、同时在线 IP、IPS、API 泛洪、全局计数。
- 封禁、全局封禁、当前计数、逐项清除、IP/账户黑白名单。
- IPS 基于 `@mertcanureten/node-waf` 的 XSS/SQLi 规则，并补充路径穿越、命令注入、扫描器 UA；命中仅拦截当前请求并计数。
- API 泛洪按窗口统计 `/api` 请求，排除健康检查、任务轮询、当前用户和 Range 请求。
- 全局计数达到阈值可自动停止用户 Web，并按恢复间隔自动恢复。
- 邮件告警：安全限制、安全告警、资源告警、系统错误。

### 本地资源配布

- 最大同时解压任务数。
- 最大同时查杀任务数。
- 重度预览全局并发（PDF / Office / 大视频）。
- 单用户预览并发。
- 日志保存上限。
- 一键清理上传临时文件与过期审计日志。

### 其他

- ClamAV 本地扫描或 VirusTotal API。
- 可选 AI 文件助手。
- 插件系统：独立子进程、manifest、HTTP 路由、事件、私有 storage、Web 主题、自定义预览、Web 接管、管理页面。
- GitHub Releases 更新检查，只提示不静默覆盖。
- SQLite 在线备份；GUI 和 Web 均支持数据/网盘/插件目录迁移；Web 备份直接下载到浏览器设备。
- 中文 / English 双语界面。

## 更新与卸载

- 检查到新版本后，管理端会后台下载匹配的安装包并显示进度。
- 下载完成后自动执行静默覆盖安装，随后重启 GUI 或 Windows 服务。
- **当前 v1.0.2 的自动更新只完成了下载/进度/SHA/状态机测试，真实旧版本到新版本的安装/重启尚未端到端验证。**
- Server 更新使用 `CloudBox-Server` 安装包；GUI 使用 `CloudBox-Setup` 安装包。
- Server 版支持 CLI 静默卸载：默认保留数据；加 `/DELETEAPPDATA` 才删除默认目录和 `cloudbox-paths.json` 记录的自定义目录。
- 卸载时系统会询问是否删除用户数据：
  - 选择“否”：只移除程序、快捷方式和注册表项，保留 `%APPDATA%\cloudbox` / `%PROGRAMDATA%\CloudBox`。
  - 选择“是”：同时删除账号、文件与配置。
  - 静默更新会跳过该询问，始终保留用户数据。

## 安全提示

- 管理 Web 的 1250 端口默认仅限内网，且没有内置 HTTPS；不要通过 frp 或公网端口转发暴露。
- 管理员 Session 固定 4 小时；登录接口使用 double-submit CSRF。
- Windows 安装包未配置代码签名，SmartScreen 可能提示“未知发布者”。

## 快速开始

### GUI 版

1. 运行 `CloudBox-Setup-<version>-x64.exe`，或直接运行便携版。
2. 首次启动创建唯一管理员账号。
3. 在「网络设置」中启动本地 Web 服务。
4. 用管理员账号登录用户 Web，在「用户管理」中创建普通用户。
5. 需要公网访问时，在「网络设置 → frp」中配置隧道。

### Web 管理版（Windows Server）

1. 运行 `CloudBox-Server-<version>-x64.exe`，安装并启动 `CloudBox` 服务。
2. 查看服务日志/控制台输出中的一次性初始化 URL：

   ```text
   http://<内网IP>:1250/setup?token=...
   ```

3. 在同一内网浏览器打开该 URL，完成管理员创建。token 默认 24 小时有效，使用后失效。
4. 登录 `http://<内网IP>:1250`，在「服务概览」中开启用户 Web。
5. 用户 Web 的端口、HTTPS、frp、用户与安全设置均在 Web 管理端配置。

初始化 token 文件位于：

```text
%PROGRAMDATA%\CloudBox\config\admin-init-token.json
```

如果 token 过期或丢失，删除该文件并重启服务即可重新生成。Web 管理端默认仅限内网；关闭内网限制前必须配置防火墙/HTTPS/可信反向代理。

## 源码开发

```bash
npm install
npm run build:web
npm run build:desktop
npm run electron:start
```

Web 管理端 / headless：

```bash
npm run build:web
npm run build:admin
npm run build:headless
node dist/headless/index.mjs
```

Windows Server 安装器需要 Inno Setup；WinSW 已包含在仓库中，具体见 [installer/README.md](installer/README.md)。

测试：

```bash
npm run typecheck
npm test
npm run e2e:electron
```

## 文档

- [配置指南（GUI 与 Web 管理）](docs/GUI_CONFIGURATION.md)
- [插件开发与 API](docs/PLUGIN_API.md)
- [架构与实现原理](docs/ARCHITECTURE.md)
- [Windows Server 安装说明](installer/README.md)
- [第三方组件声明](THIRD_PARTY_NOTICES.md)
- [开发与交接指南](docs/HANDOVER.md)
- [v1.0.2 静态审计报告](docs/AUDIT-v1.0.2.md)

## 开源项目与致谢

CloudBox 建立在这些开源项目之上，感谢所有维护者和贡献者。

### 桌面与构建

- [Electron](https://www.electronjs.org/) — 桌面运行时
- [electron-builder](https://www.electron.build/) — Windows 安装包与便携版
- [Vite](https://vite.dev/) — Web / 管理端前端构建
- [TypeScript](https://www.typescriptlang.org/) — 类型系统
- [Tailwind CSS](https://tailwindcss.com/) — 管理端样式
- [@tailwindcss/vite](https://tailwindcss.com/docs/installation/using-vite) — Tailwind Vite 集成
- [React](https://react.dev/) — 管理端与 Web 端 UI
- [i18next](https://www.i18next.com/) / [react-i18next](https://react.i18next.com/) — 国际化
- [esbuild](https://esbuild.github.io/) — 主进程 / preload / headless 打包
- [@electron/rebuild](https://github.com/electron/rebuild) — 原生模块重建

### 服务端与数据

- [Express](https://expressjs.com/) — HTTP 服务
- [Helmet](https://helmetjs.github.io/) — 安全响应头
- [express-rate-limit](https://express-rate-limit.mintlify.app/) — 基础限流
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite 访问
- [Zod](https://zod.dev/) — 输入校验
- [busboy](https://github.com/mscdex/busboy) — 流式上传
- [file-type](https://github.com/sindresorhus/file-type) — 文件类型嗅探
- [mime-types](https://github.com/jshttp/mime-types) — MIME 映射
- [chardet](https://github.com/runk/node-chardet) / [iconv-lite](https://github.com/ashtuchkin/iconv-lite) — 文本编码识别
- [nodemailer](https://nodemailer.com/) — SMTP 邮件
- [node-forge](https://github.com/digitalbazaar/forge) / [@mkcert/node](https://github.com/liuweiqiang1/mkcert-node) — 证书与私有 CA
- [qrcode](https://github.com/soldair/node-qrcode) — 二维码
- [WinSW](https://github.com/winsw/winsw) — Windows 服务包装
- [Inno Setup](https://jrsoftware.org/isinfo.php) — Windows Server 安装器

### 安全

- [Cap](https://capjs.js.org/) / [capjs-core](https://github.com/tiagorangel1/cap) / [@cap.js/widget](https://www.npmjs.com/package/@cap.js/widget) — PoW 人机验证
- [@mertcanureten/node-waf](https://github.com/mertcanureten/node-waf) — WAF 规则库
- [OWASP Core Rule Set](https://owasp.org/www-project-mod-security-crs/) — IPS 特征思路与规则来源
- [ClamAV](https://www.clamav.net/) — 本地病毒查杀
- [VirusTotal API](https://developers.virustotal.com/) — 在线查杀
- [Zustand](https://zustand-demo.pmnd.rs/) — Web 端状态管理

### 文件与预览

- [7-Zip](https://www.7-zip.org/) / [7zip-bin](https://github.com/develar/7zip-bin) / [node-7z](https://github.com/onebeyond/node-7z) — 压缩包处理
- [adm-zip](https://github.com/cthackers/adm-zip) — ZIP 处理
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF 预览
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) — Word 预览
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel 预览
- [pptx-preview](https://github.com/pipipi-pikachu/pptx-preview) — PPT 预览
- [ECharts](https://echarts.apache.org/) — 图表渲染依赖

### 测试与审计

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [Playwright](https://playwright.dev/) — 浏览器 / Electron E2E
- [DeepSeek Harness / DSH](https://github.com/deepseek-ai/deepseek-harness) — 本次版本开发、静态审计与动态测试使用 DSH 及其插件生态
- [dsh-pentester](https://github.com/howmp/dsh-pentest) — PTES 渗透测试流程与 Skill 参考

## 关于 DSH

CloudBox 的运行不依赖 DSH。DSH 是本项目开发阶段使用的开源智能体工具链，用于代码实现、静态审计、动态渗透测试与文档整理。相关审计结论只代表本次测试范围，不构成对任何部署环境的安全保证。

## 数据与隐私

- 文件与数据库默认保存在本机，不上传到第三方云盘。
- AI、SMTP、VirusTotal 只有在管理员主动配置后才会向外部发起请求。
- 插件运行在独立子进程；安装第三方插件前请确认来源。
- 静态托管页面与主站隔离，不能直接调用主站 API。
- `ai-secret.key` 用于加密 AI Key / SMTP 密码；备份数据库时请一并备份该文件，丢失后已加密字段无法恢复。

## 许可证

项目源代码采用 MIT License。第三方组件遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

# English

CloudBox is a private network drive and file management service for Windows. Files stay on your own computer or server; LAN users access them through a browser, and frp can be configured for public access.

Current version: **1.0.2**

CloudBox has two runtime forms. They share the same users, files, security policy and SQLite database, but differ in management entry point and deployment.

| | Electron GUI | Web Admin (headless) |
|---|---|---|
| Use case | Personal desktop | Windows Server / long-running service |
| Admin entry | Electron window | Browser at `http://<LAN-IP>:1250` |
| Admin login | First-run wizard + GUI login | `/setup?token=...`, then login at 1250 |
| Data directory | `%APPDATA%\cloudbox` | `%PROGRAMDATA%\CloudBox` |
| Installation | NSIS installer / portable | WinSW + Inno Setup service installer |
| User Web | Toggled by GUI online mode | Admin Web always on; user Web toggled separately |
| Desktop-only actions | Native file picker, startup/tray | Directory migration uses an absolute path; certificates, plugins and CA export use browser file streams |

> The admin Web port 1250 is LAN-only by default. **Do not map 1250 through frp or public port forwarding.** frp should only expose the user Web port.

## Highlights

### Two management forms

- **Electron GUI**: graphical control of service, port, HTTPS, frp, users, files, plugins, security and logs.
- **Web Admin**: independent 1250 service with setup token, separate Session/CSRF, 4-hour admin sessions, session list/revoke-all, logs, users, settings, frp, CA, directory migration, plugin ZIP import and browser-side database backup.
- Both use the same `admin/src` pages and `core/services`; Web uses `/api/admin/*`, GUI uses Electron IPC.
- GUI starts offline to avoid listening immediately after installation. Web Admin always starts; user Web is controlled by online mode.

### Files and previews

- Multi-user storage and quotas.
- Upload, download, move, copy, rename, delete and folders.
- Image, video, audio, PDF, Word, Excel, PowerPoint, text/code preview.
- Upload queue with 10 concurrent uploads by default.
- Expiring share links.
- Static hosting under `/host/`, isolated from the main API.

### frp

- Configure frps host, port, token, user, tunnel type and public mapping in GUI or Web Admin.
- HTTP / HTTPS / TCP tunnels.
- HTTP/HTTPS preserve the real client IP; TCP supports PROXY Protocol v2.
- Optional `tcpMux`; health checks share the TCP connection.
- Generate frpc config and control start/stop/restart/logs.
- **frp maps the user Web only. Never expose admin Web 1250 through frp.**

### One-click CA and HTTPS

- Create/install a private CA and export client certificates.
- Import certificate/key and switch to HTTPS.
- mTLS client certificates.
- Roll back failed network changes.

### Network security

- **Simple mode**: legacy account lock, IP login limit, rename limit and registration limit.
- **Advanced mode**: drag-and-drop policy cards with IP / account / global scopes.
- Optional policies: login failure, registration, rename, Cap, concurrent sessions, historical IPs, concurrent IPs, IPS, API flood and global counters.
- Bans, global bans, counters, per-item clear and IP/account allow/deny lists.
- IPS uses `@mertcanureten/node-waf` XSS/SQLi rules plus path traversal, command injection and scanner UA signatures. A hit blocks only the current request and counts.
- API flood counts `/api` requests per window, excluding health, task polling, current-user and Range requests.
- Global counters can stop user Web and recover after an interval.
- Email alerts for security limits, security alerts, resource alerts and system errors.

### Local resources

- Max concurrent extraction tasks.
- Max concurrent scan tasks.
- Global heavy preview concurrency (PDF / Office / large video).
- Per-user preview concurrency.
- Log size limit.
- Cleanup of temporary uploads and expired audit logs.

### Other

- ClamAV local scan or VirusTotal API.
- Optional AI assistant.
- Plugins: isolated child process, manifest, HTTP routes, events, private storage, Web theme, custom preview, Web takeover and admin page.
- GitHub Releases update check without silent replacement.
- SQLite online backup; GUI and Web directory migration; Web browser download.
- Chinese / English UI.

## Updates and uninstall

- When an update is available, the admin downloads the matching installer in the background with progress.
- After verification the installer runs silently and the GUI/service restarts.
- **The v1.0.2 auto-updater has unit coverage for download/progress/SHA/state, but a real old-version-to-new-version install/restart has not yet been verified end-to-end.**
- Server updates use the `CloudBox-Server` package; GUI updates use `CloudBox-Setup`.
- Server supports CLI uninstall: default keeps data; `/DELETEAPPDATA` deletes defaults and custom paths recorded in `cloudbox-paths.json`.
- The uninstaller asks whether to delete user data:
  - No: remove only the program, shortcuts and registry entries; keep `%APPDATA%\cloudbox` / `%PROGRAMDATA%\CloudBox`.
  - Yes: also delete accounts, files and configuration.
  - Silent updates skip the prompt and always preserve user data.

## Security notes

- Admin Web 1250 is LAN-only by default and has no built-in HTTPS; never expose it through frp or public port forwarding.
- Admin sessions are fixed at 4 hours; login uses double-submit CSRF.
- Windows installers are unsigned; SmartScreen may warn about an unknown publisher.

## Quick start

### GUI

1. Run `CloudBox-Setup-<version>-x64.exe` or the portable build.
2. Create the administrator account on first launch.
3. Start the local Web service in Network settings.
4. Sign in to the user Web and create users.
5. Configure an frp tunnel in Network settings if public access is needed.

### Web Admin (Windows Server)

1. Run `CloudBox-Server-<version>-x64.exe` and start the `CloudBox` service.
2. Find the one-time setup URL in service logs/console:

   ```text
   http://<LAN-IP>:1250/setup?token=...
   ```

3. Open it from the same LAN, create the administrator. The token is valid for 24 hours and is consumed.
4. Sign in at `http://<LAN-IP>:1250` and enable user Web from the dashboard.
5. Configure user Web port, HTTPS, frp, users and security from the admin Web.

The setup token file is:

```text
%PROGRAMDATA%\CloudBox\config\admin-init-token.json
```

If it expires or is lost, delete it and restart the service. Admin Web is LAN-only by default; configure firewall/HTTPS/trusted reverse proxy before disabling that restriction.

## Development

```bash
npm install
npm run build:web
npm run build:desktop
npm run electron:start
```

Headless / Web Admin:

```bash
npm run build:web
npm run build:admin
npm run build:headless
node dist/headless/index.mjs
```

Windows Server installer prerequisites (Inno Setup; WinSW is included) are documented in [installer/README.md](installer/README.md).

Tests:

```bash
npm run typecheck
npm test
npm run e2e:electron
```

## Documentation

- [Configuration guide (GUI and Web Admin)](docs/GUI_CONFIGURATION.md)
- [Plugin development and API](docs/PLUGIN_API.md)
- [Architecture and implementation](docs/ARCHITECTURE.md)
- [Windows Server installation](installer/README.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Development and handover guide](docs/HANDOVER.md)
- [v1.0.2 static audit](docs/AUDIT-v1.0.2.md)

## Open-source projects

CloudBox is built on open-source software. Thanks to all maintainers and contributors.

### Desktop and build

- [Electron](https://www.electronjs.org/) — desktop runtime
- [electron-builder](https://www.electron.build/) — Windows installer and portable build
- [Vite](https://vite.dev/) — Web/admin frontend build
- [TypeScript](https://www.typescriptlang.org/) — type system
- [Tailwind CSS](https://tailwindcss.com/) — admin styling
- [React](https://react.dev/) — admin and Web UI
- [i18next](https://www.i18next.com/) / [react-i18next](https://react.i18next.com/) — internationalization
- [esbuild](https://esbuild.github.io/) — main/preload/headless bundling
- [@electron/rebuild](https://github.com/electron/rebuild) — native module rebuild

### Server and data

- [Express](https://expressjs.com/) — HTTP server
- [Helmet](https://helmetjs.github.io/) — security headers
- [express-rate-limit](https://express-rate-limit.mintlify.app/) — baseline rate limiting
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite access
- [Zod](https://zod.dev/) — input validation
- [busboy](https://github.com/mscdex/busboy) — streaming uploads
- [file-type](https://github.com/sindresorhus/file-type) — file type sniffing
- [mime-types](https://github.com/jshttp/mime-types) — MIME mapping
- [chardet](https://github.com/runk/node-chardet) / [iconv-lite](https://github.com/ashtuchkin/iconv-lite) — text encoding
- [nodemailer](https://nodemailer.com/) — SMTP
- [node-forge](https://github.com/digitalbazaar/forge) / [@mkcert/node](https://github.com/liuweiqiang1/mkcert-node) — certificates and private CA
- [qrcode](https://github.com/soldair/node-qrcode) — QR codes
- [WinSW](https://github.com/winsw/winsw) — Windows service wrapper
- [Inno Setup](https://jrsoftware.org/isinfo.php) — Windows Server installer

### Security

- [Cap](https://capjs.js.org/) / [capjs-core](https://github.com/tiagorangel1/cap) / [@cap.js/widget](https://www.npmjs.com/package/@cap.js/widget) — proof-of-work challenge
- [@mertcanureten/node-waf](https://github.com/mertcanureten/node-waf) — WAF rules
- [OWASP Core Rule Set](https://owasp.org/www-project-mod-security-crs/) — IPS signature reference
- [ClamAV](https://www.clamav.net/) — local antivirus
- [VirusTotal API](https://developers.virustotal.com/) — online scanning
- [Zustand](https://zustand-demo.pmnd.rs/) — Web state management

### Files and preview

- [7-Zip](https://www.7-zip.org/) / [7zip-bin](https://github.com/develar/7zip-bin) / [node-7z](https://github.com/onebeyond/node-7z) — archives
- [adm-zip](https://github.com/cthackers/adm-zip) — ZIP handling
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF preview
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) — Word preview
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel preview
- [pptx-preview](https://github.com/pipipi-pikachu/pptx-preview) — PowerPoint preview
- [ECharts](https://echarts.apache.org/) — chart rendering dependency

### Testing and audit

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [Playwright](https://playwright.dev/) — browser/Electron E2E
- [DeepSeek Harness / DSH](https://github.com/deepseek-ai/deepseek-harness) — development, static audit and dynamic testing
- [dsh-pentester](https://github.com/howmp/dsh-pentest) — PTES workflow and Skill reference

## About DSH

CloudBox does not depend on DSH at runtime. DSH is the open-source agent toolchain used during development for implementation, static audit, dynamic penetration testing and documentation. Findings only represent the tested scope and are not a security guarantee for any deployment.

## Data and privacy

- Files and database stay local by default; no third-party cloud upload.
- AI, SMTP and VirusTotal only make outbound requests after administrator configuration.
- Plugins run in isolated child processes; verify third-party sources before installing.
- Hosted pages are isolated from the main API.
- `ai-secret.key` encrypts AI keys and SMTP passwords. Back it up with the database; lost encrypted fields cannot be recovered.

## License

Source code is MIT licensed. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
