# CloudBox

CloudBox 是一个运行在 Windows 本机的小型私有网盘与控制台：文件保存在自己的电脑或服务器上，局域网用户通过浏览器访问，需要公网访问时可在 GUI 内配置 frp。

当前版本：**1.0.1**

## 功能亮点

### GUI 管理，不依赖命令行

- Electron 管理控制台：服务启停、端口、HTTPS、frp、用户、文件、插件、安全策略和日志全部图形化配置。
- 首次启动创建管理员账户；日常操作不需要编辑配置文件。
- 深色 / 浅色主题切换，设置自动保存并在重启后保留。
- 系统设置按管理员账户、安全与运行、功能控制、系统与存储分块。

### 文件与预览

- 多用户、独立存储目录、容量配额。
- 上传、下载、移动、复制、重命名、删除、文件夹管理。
- 图片、视频、音频、PDF、Word、Excel、PPT、文本/代码在线预览。
- 多文件上传使用并发队列（最多 10 个并发），避免瞬间请求过多。
- 分享直链与有效期控制。
- 静态网站托管：把网盘目录发布为 `/host/` 下的站点，页面与主站隔离。

### frp 内网穿透

- 在 GUI 内填写 frps 地址、端口、token、隧道类型和公网映射。
- 支持 HTTP / HTTPS / TCP 隧道。
- HTTP/HTTPS 可保留真实客户端 IP；TCP 可启用 PROXY Protocol v2。
- TCP 可启用 `tcpMux`，并配置健康检查与业务流量共用 TCP。
- 服务端与 frpc 配置自动生成、启动、停止和状态展示。

### 一键 CA 与 HTTPS

- 私有 CA 一键创建、安装到系统信任库、导出客户端证书。
- 支持导入证书/私钥，在线切换 HTTPS。
- 支持 mTLS 客户端证书。
- 修改端口或网络配置失败时回滚，避免服务不可用。

### 网络安全

- **简洁模式**：旧版账号锁定、IP 限流、改名限制、注册限流，适合新手。
- **高级模式**：拖拽式策略卡，支持 IP / 账户 / 全局三个作用域。
- 可选策略：登录失败、注册量、改名、Cap、同时在线人数、历史 IP、同时在线 IP、IPS、API 泛洪、全局计数。
- 视图包含策略封禁、IP/账户全局封禁、当前计数和逐项清除。
- IPS 使用 `@mertcanureten/node-waf` 的 XSS/SQLi 规则，并补充路径穿越、命令注入、扫描器 UA；命中仅拦截当前请求并计数。
- API 泛洪拦截按时间窗口统计 `/api` 请求，排除健康检查、任务轮询、当前用户和 Range 分段请求。
- 全局计数达到阈值可自动停止 Web 服务，并按恢复间隔自动恢复。
- IP / 账户黑白名单。
- 邮件安全告警、策略封禁通知、资源告警。

### 本地资源配布

- 最大同时解压任务数
- 最大同时查杀任务数
- 重度预览全局并发（PDF / Office / 大视频）
- 单用户预览并发
- 日志保存上限
- 一键清理上传临时文件与过期审计日志

### 其他

- 安全查杀：ClamAV 本地扫描或 VirusTotal API。
- AI 文件助手（可选，需管理员配置）。
- 插件系统：独立子进程、manifest、HTTP 路由、事件、独立 storage、Web 主题、自定义预览、Web 接管、管理页面。
- 自动更新检查：只提示 GitHub Releases，不静默覆盖。
- SQLite 在线备份；数据目录、网盘目录、插件目录可迁移。
- 中文 / English 双语界面。

## 快速开始

1. 运行 `CloudBox-Setup-<version>-x64.exe`，或直接运行便携版。
2. 首次启动创建管理员账户。
3. 在“网络设置”中启动本地 Web 服务。
4. 用管理员账户登录 Web 端，在“用户管理”中创建普通用户。
5. 需要公网访问时，在“网络设置 → frp”中配置隧道。

源码开发：

```bash
npm install
npm run build:web
npm run build:desktop
npm run electron:start
```

测试：

```bash
npm run typecheck
npm test
```

## 文档

- [GUI 配置详解](docs/GUI_CONFIGURATION.md)
- [插件开发与 API](docs/PLUGIN_API.md)
- [架构与实现原理](docs/ARCHITECTURE.md)
- [第三方组件声明](THIRD_PARTY_NOTICES.md)

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

### 安全

- [Cap](https://capjs.js.org/) / [capjs-core](https://github.com/tiagorangel1/cap) / [@cap.js/widget](https://www.npmjs.com/package/@cap.js/widget) — PoW 人机验证
- [@mertcanureten/node-waf](https://github.com/mertcanureten/node-waf) — WAF 规则库
- [OWASP Core Rule Set](https://owasp.org/www-project-mod-security-crs/) — IPS 特征思路与规则来源
- [ClamAV](https://www.clamav.net/) — 本地病毒查杀
- [VirusTotal API](https://developers.virustotal.com/) — 在线查杀
- [clamscan](https://github.com/kylefarris/clamscan) — ClamAV Node.js 封装
- [Zustand](https://zustand-demo.pmnd.rs/) — Web 端状态管理
- [esbuild](https://esbuild.github.io/) — 主进程/预加载脚本打包
- [@electron/rebuild](https://github.com/electron/rebuild) — 原生模块重建

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
- [Playwright](https://playwright.dev/) — 浏览器 E2E
- [DeepSeek Harness / DSH](https://github.com/deepseek-ai/deepseek-harness) — 本次版本的开发、静态审计与动态渗透测试使用 DSH 及其插件生态
- [dsh-pentester](https://github.com/howmp/dsh-pentest) — PTES 渗透测试流程与 Skill 参考

## 关于 DSH

CloudBox 的运行不依赖 DSH。DSH 是本项目开发阶段使用的开源智能体工具链：用于代码实现、静态审计、动态渗透测试与文档整理。相关审计结论只代表本次测试范围，不构成对任何部署环境的安全保证。

## 数据与隐私

- 文件与数据库默认保存在本机，不上传到第三方云盘。
- AI、SMTP、VirusTotal 只有在管理员主动配置后才会向外发起请求。
- 插件运行在独立子进程中；安装第三方插件前请确认来源。
- 静态托管页面与主站隔离，不能直接调用主站 API。
- `ai-secret.key` 用于加密 AI Key / SMTP 密码，备份数据库时请一并备份该文件；丢失后已加密字段无法恢复。

## 许可

项目源代码采用 MIT License。第三方组件遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

# English

CloudBox is a small private network drive and control panel for Windows. Files stay on your own computer or server, LAN users access them through a browser, and frp can be configured from the GUI when public access is needed.

Current version: **1.0.1**

## Highlights

### GUI-first management

- Electron admin console for service start/stop, port, HTTPS, frp, users, files, plugins, security and logs.
- Create the administrator account on first launch; no config-file editing for daily use.
- Dark / light theme, persisted across restarts.
- Settings grouped into Administrator account, Security & operations, Feature controls, and System & storage.

### Files and preview

- Multi-user storage with quotas.
- Upload, download, move, copy, rename, delete and folder management.
- Preview images, video, audio, PDF, Word, Excel, PowerPoint, text and code.
- Bulk upload queue with at most 10 concurrent uploads.
- Expiring share links.
- Static hosting under `/host/`, isolated from the main site.

### frp

- Configure frps host, port, token, tunnel type and public mapping in the GUI.
- HTTP / HTTPS / TCP tunnels.
- HTTP/HTTPS preserves the real client IP; TCP supports PROXY Protocol v2.
- Optional `tcpMux` and TCP health check sharing the same connection.
- Generated server/frpc configuration, lifecycle control and status display.

### One-click CA and HTTPS

- Create and install a private CA, export client certificates.
- Import certificate/key and switch HTTPS online.
- mTLS client certificates.
- Roll back a failed network change instead of leaving the service unavailable.

### Network security

- **Simple mode**: legacy account lock, IP rate limit, rename limit and registration limit. Beginner friendly.
- **Advanced mode**: drag-and-drop policy cards with IP / account / global scopes.
- Cards include login failure, registration, rename, Cap, concurrent sessions, historical IPs, concurrent IPs, IPS, API flood and global counters.
- Bans, global bans, current counts and per-item clearing.
- IPS uses `@mertcanureten/node-waf` XSS/SQLi rules plus path traversal, command injection and scanner UA signatures. A hit blocks only the current request and counts it.
- API flood protection counts `/api` requests per window and excludes health checks, task polling, current-user calls and Range requests.
- Global counts can automatically stop the Web service and recover after a configured interval.
- IP/account allow/deny lists.
- Email alerts for security limits and resource events.

### Local resource allocation

- Max concurrent extraction tasks.
- Max concurrent scan tasks.
- Global heavy-preview concurrency (PDF / Office / large video).
- Per-user preview concurrency.
- Log size limit.
- One-click cleanup of temporary uploads and expired audit logs.

### Other

- ClamAV local scan or VirusTotal API.
- Optional AI file assistant.
- Plugin system: isolated child process, manifest, HTTP routes, events, private storage, Web theme, custom preview, Web takeover and admin page.
- GitHub Releases update check without silent replacement.
- SQLite online backup; data, drive and plugin directories are movable.
- Chinese / English UI.

## Quick start

1. Run `CloudBox-Setup-<version>-x64.exe`, or run the portable build.
2. Create the administrator account on first launch.
3. Start the local Web service in Network settings.
4. Sign in to the Web UI and create regular users.
5. Configure an frp tunnel in Network settings for public access.

Development:

```bash
npm install
npm run build:web
npm run build:desktop
npm run electron:start
```

Tests:

```bash
npm run typecheck
npm test
```

## Documentation

- [GUI configuration](docs/GUI_CONFIGURATION.md)
- [Plugin development and API](docs/PLUGIN_API.md)
- [Architecture and implementation](docs/ARCHITECTURE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

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
- [esbuild](https://esbuild.github.io/) — main/preload bundling
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
- [chardet](https://github.com/runk/node-chardet) / [iconv-lite](https://github.com/ashtuchkin/iconv-lite) — text encoding detection
- [nodemailer](https://nodemailer.com/) — SMTP email
- [node-forge](https://github.com/digitalbazaar/forge) / [@mkcert/node](https://github.com/liuweiqiang1/mkcert-node) — certificates and private CA
- [qrcode](https://github.com/soldair/node-qrcode) — QR codes

### Security

- [Cap](https://capjs.js.org/) / [capjs-core](https://github.com/tiagorangel1/cap) / [@cap.js/widget](https://www.npmjs.com/package/@cap.js/widget) — proof-of-work challenge
- [@mertcanureten/node-waf](https://github.com/mertcanureten/node-waf) — WAF rules
- [OWASP Core Rule Set](https://owasp.org/www-project-mod-security-crs/) — IPS signature reference
- [ClamAV](https://www.clamav.net/) — local antivirus
- [clamscan](https://github.com/kylefarris/clamscan) — ClamAV Node.js wrapper
- [VirusTotal API](https://developers.virustotal.com/) — online scanning

### Files and preview

- [7-Zip](https://www.7-zip.org/) / [7zip-bin](https://github.com/develar/7zip-bin) / [node-7z](https://github.com/onebeyond/node-7z) — archive handling
- [adm-zip](https://github.com/cthackers/adm-zip) — ZIP handling
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF preview
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) — Word preview
- [ExcelJS](https://github.com/exceljs/exceljs) — Excel preview
- [pptx-preview](https://github.com/pipipi-pikachu/pptx-preview) — PowerPoint preview
- [ECharts](https://echarts.apache.org/) — chart dependency
- [Zustand](https://zustand-demo.pmnd.rs/) — Web state management

### Testing and audit

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [Playwright](https://playwright.dev/) — browser E2E
- [DeepSeek Harness / DSH](https://github.com/deepseek-ai/deepseek-harness) — used for development, static audit and dynamic penetration testing in this release
- [dsh-pentester](https://github.com/howmp/dsh-pentest) — PTES workflow and skill reference

## About DSH

CloudBox does not depend on DSH at runtime. DSH is the open-source agent toolchain used during development for implementation, static auditing, dynamic penetration testing and documentation. Audit results cover only the tested scope and are not a security guarantee for any deployment.

## Data and privacy

- Files and database stay local by default.
- AI, SMTP and VirusTotal only make outbound requests after the administrator configures them.
- Plugins run in a separate child process; verify the source before installing third-party plugins.
- Hosted static sites are isolated from the main site API.
- `ai-secret.key` encrypts AI keys and SMTP passwords. Back it up with the database; encrypted fields cannot be recovered without it.

## License

Source code is MIT licensed. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
