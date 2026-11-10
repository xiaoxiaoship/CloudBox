# CloudBox 使用与实现说明 / Usage & Implementation

> 本文件是 Windows GUI 版的详细说明。根 README 只列功能；这里是每个功能的用途、填写方式和实现方式。
>
> This is the detailed guide for the Windows GUI build. The root README lists features only; this document explains what each feature does, how to configure it, and how it is implemented.

---

# 中文

## 1. 安装与首次启动

- 安装版：运行 `CloudBox-Setup-1.0.0-x64.exe`，按向导安装。安装版支持开机自启和覆盖升级。
- 便携版：运行 `CloudBox-Portable-1.0.0-x64.exe`，程序文件可放在任意目录；替换新版程序文件即可升级。
- 首次启动会要求创建唯一管理员账号。管理员用户名 3–20 位字母或数字，密码至少 8 位并包含字母和数字。
- 关闭主窗口不会退出程序，程序会留在系统托盘；右键托盘图标可退出。

## 2. 账号与权限

- 用户管理：创建普通用户、分配容量配额、重置密码、禁用/启用账号、删除账号。
- 配额：`不限量` 或指定容量。降低到已用空间以下不会删除现有文件，但会阻止继续上传。
- 登录保护：可设置失败次数、锁定分钟数、最长锁定时间、单 IP 请求上限和统计窗口。
- 改名限制：可设置普通用户改名次数和统计窗口；管理员不受限制。
- 用户功能权限：图片、视频、PDF、Office、解压、查杀开关。关闭后 Web 入口隐藏，后端接口返回 403。

填写建议：

- 失败次数阈值建议 5 次，首次锁定 15 分钟，最长 24 小时。
- 单 IP 登录上限建议 30 次/10 分钟。
- 面向公网时不要把配额设得过高，先按实际磁盘剩余空间设置。

## 3. 文件功能

- 上传：拖拽或点击上传；支持多文件和文件夹上传。
- 移动/复制：选择项目后点击“移动/复制”，输入目标文件夹路径；留空表示根目录。
- 重命名：文件名不能包含 Windows 非法字符 `< > : " | ? *`，不能以点或空格结尾，不能使用 `CON`、`NUL` 等保留设备名。
- 在线解压：支持 zip、7z、rar、tar.gz；会阻止包含 `../` 的压缩包逃逸。
- 查杀：配置 ClamAV 本地目录或 VirusTotal API Key；标记为 infected 的文件禁止下载、分享和解压。
- 分享：生成带有效期的直链；任何拿到链接的人都可以下载，过期自动失效。

## 4. 在线预览

支持：

- 图片：PNG/JPG/WebP/GIF/BMP
- 视频：MP4/WebM/Ogg
- 音频：MP3/WAV/Ogg/FLAC/AAC/M4A
- PDF
- Word `.docx`、Excel `.xlsx`、PowerPoint `.pptx`
- 文本/代码类文件
- 插件自定义预览（例如 `.json` 由 json-explorer 插件渲染）

Office 预览只接受新格式；旧 `.doc/.xls/.ppt` 需要先另存为新格式。管理员可在“用户功能权限”中单独关闭 Office 预览。

## 5. 静态网站托管

用途：把网盘中的文件夹发布成网站。文件夹必须包含 `index.html`。

填写：

- 站点根目录：相对网盘路径，例如 `public` 或 `dist`。
- 访问权限：公开（任何人）或私有（必须登录 CloudBox）。
- 公网基础地址：用于生成对外链接，例如 `https://pan.example.com`。使用 frp HTTP/HTTPS 隧道时填公网域名；直接用 IP 访问时可填 `https://公网IP:端口/`。

注意：

- 站点文件仍受 safePath 校验，不能读取网盘目录外的文件。
- 托管页面不能 fetch CloudBox API，也不能提交表单到主站；这是为了防止恶意站点借用登录 Cookie。
- 页面中的相对 CSS、图片、JS 可以加载；外部 CDN 资源建议下载到站点目录后使用。

## 6. 网络设置

- 监听端口：1024–65535。修改后如果在线会自动重启，失败回滚旧端口。
- HTTP/HTTPS：HTTPS 使用内置证书或导入证书/私钥；公网建议正式证书，局域网自签证书会有浏览器警告。
- TLS 证书：导入 `.crt/.pem/.cer` 与 `.key`，点击“应用并重启”生效。
- 私有 CA：可一键生成并安装到系统信任库，适合局域网自签场景；卸载只会从系统信任库移除，文件仍保留。
- 客户端证书（mTLS）：开启后浏览器必须导入导出的 PKCS#12 文件，密码默认 `changeit`。
- frp：填写 frps 地址、端口、token、隧道类型、公网映射端口、域名。HTTP/HTTPS 隧道能保留真实客户端 IP；TCP 隧道不能。
- 定时开关：设置每天的启停时间，跨午夜也会识别。
- 开机自动在线：程序启动后自动开启 Web 服务。
- 信任反向代理真实 IP：仅在确实位于 frp/Nginx 后面时开启，直连暴露端口时保持关闭。

## 7. 插件

- 导入：选择 zip 或包含 `manifest.json` 的文件夹。
- 启用/禁用：启用后插件在独立子进程运行；禁用会停止进程。
- Web 接管：高风险选项，开启后普通用户访问 `/` 会看到插件页面。只对完全可信插件开启。
- 自定义预览：插件在 manifest 中声明 `previews`，例如 `[".json"]`；主程序通过 `/api/plugins/previewers` 返回映射，Web 预览时用 iframe 加载插件页面。
- 插件只能使用标准 `/api/*` 接口，仍需登录 Session 与 CSRF；管理员应审查插件来源。

示例插件 `json-explorer` 源码在 `resources/plugins/json-explorer/`，安装到用户插件目录并启用后，点击 `.json` 文件即可看到可折叠 JSON 树。

## 8. 更新

- 系统设置底部点击“更新-关于”，再点击“检查更新”。
- 程序读取 GitHub Releases 最新版本，12 小时内缓存，避免频繁请求 GitHub API。
- 发现新版本只展示更新说明和下载按钮，不会静默替换程序。
- 安装版覆盖安装；便携版替换程序文件；账号、数据库和网盘文件默认保留。
- 更新仓库可在设置表 `system.updateRepo` 中配置，格式 `owner/repo`。

## 9. 数据目录与备份

- 系统数据目录：`cloudbox.db`、SSL 证书、CA、frp 配置、`ai-secret.key`。
- 网盘文件目录：所有用户上传文件。
- 插件目录：已安装插件及插件私有 storage。
- 修改目录时可选择迁移数据；迁移会复制数据库、配置和加密密钥。勾选“迁移完成后删除旧文件”会在重启前删除原目录，操作不可撤销。
- 备份：系统设置提供 SQLite 在线备份；建议同时备份网盘文件目录和 `ai-secret.key`。没有密钥，已加密的 AI Key/SMTP 密码无法解密。

## 10. 常见问题

- 浏览器提示证书不受信任：局域网自签证书正常现象；可安装私有 CA，或使用正式证书。
- 页面能打开但图片/CSS 404：检查站点根目录和相对路径；站点必须部署包含 `index.html` 的文件夹。
- frp 后所有用户像同一个 IP：TCP 隧道不携带 X-Forwarded-For；改用 HTTP/HTTPS 隧道，并在 CloudBox 中开启“信任反向代理真实 IP”。
- 忘记管理员密码：使用安装目录中的管理员重置工具，或按数据目录备份恢复；不要直接删除数据库。
- 更新提示失败：检查 `system.updateRepo` 是否正确，以及机器是否能访问 `api.github.com`。

---

# English

## 1. Install and first run

- Installer: run `CloudBox-Setup-1.0.0-x64.exe`. Installed builds support login startup and in-place upgrades.
- Portable: run `CloudBox-Portable-1.0.0-x64.exe`; replace the program file to upgrade.
- First run asks you to create the only administrator account. Username: 3–20 letters/digits; password: at least 8 characters with letters and digits.
- Closing the window keeps CloudBox in the system tray. Use the tray menu to quit.

## 2. Accounts and permissions

- Users: create regular users, assign quotas, reset passwords, disable/enable, delete.
- Quota: unlimited or a fixed size. Lowering below used space keeps files but blocks new uploads.
- Login protection: failed-attempt threshold, base/max lock minutes, per-IP request limit and window.
- Rename limits: per-user rename count/window; administrators are exempt.
- Feature permissions: image/video/PDF/Office preview, extraction, scanning. Disabling hides the Web entry and returns 403 from APIs.

Suggested values: 5 failures, 15-minute first lock, 24-hour max, 30 login attempts per IP per 10 minutes.

## 3. Files

- Upload by drag/drop or button; multiple files and folders supported.
- Move/copy: select items, enter a target folder, or leave blank for root.
- Names cannot contain `< > : " | ? *`, end with a dot/space, or use reserved names such as `CON`/`NUL`.
- Extraction: zip, 7z, rar, tar.gz; `../` zip-slip is blocked.
- Scanning: ClamAV local directory or VirusTotal API key; infected files are blocked from download/share/extract.
- Sharing: expiring direct links; anyone with the link can download until it expires.

## 4. Preview

Images, video, audio, PDF, `.docx`, `.xlsx`, `.pptx`, text/code, and plugin-defined previews (for example `.json` via json-explorer). Legacy `.doc/.xls/.ppt` must be saved in the newer format first. Office preview can be disabled separately in feature permissions.

## 5. Static hosting

Publish a drive folder containing `index.html`.

- Root folder: relative path such as `public` or `dist`.
- Visibility: public or private (CloudBox login required).
- Public base URL: e.g. `https://pan.example.com`, or `https://public-ip:port/` when using an IP.

SafePath prevents escaping the drive. Hosted pages cannot call CloudBox APIs or submit forms to the main site, preventing session-cookie abuse. Relative CSS/images/JS work; copy CDN assets locally if needed.

## 6. Network

- Port 1024–65535; online changes restart and roll back on failure.
- HTTP/HTTPS; import certificate/key for public use. Self-signed LAN certs trigger browser warnings.
- Private CA: generate/install into the system trust store. Uninstall only removes trust; files remain.
- mTLS: clients must import the exported PKCS#12; default password `changeit`.
- frp: fill frps host/port/token/tunnel/public port/domain. HTTP/HTTPS preserves client IP; TCP does not.
- Schedule, startup auto-online, and trust-proxy options are available. Enable trust-proxy only behind frp/Nginx.

## 7. Plugins

Import a zip or a folder with `manifest.json`; enable to run in an isolated child process. Web takeover is high risk and should only be enabled for fully trusted plugins. Plugins can declare `previews` (e.g. `[".json"]`); `/api/plugins/previewers` maps extensions and the Web UI loads the plugin preview in an iframe. Plugins still use normal Session/CSRF-protected APIs.

## 8. Updates

Open “Updates & About” at the bottom of Settings, then “Check for updates”. The app caches GitHub Releases for 12 hours and only shows release notes + a download button; it never silently replaces the program. Installed builds upgrade in place; portable builds replace the executable. Accounts and drive data are preserved. Repository is configurable via `system.updateRepo` (`owner/repo`).

## 9. Data and backup

System data: `cloudbox.db`, TLS/CA files, frp config, `ai-secret.key`. Drive files and plugins are separate directories. Directory migration copies database/config/encryption key; optional old-directory deletion is irreversible. Back up the database, drive directory, and `ai-secret.key`. Without the key, encrypted AI/SMTP secrets cannot be decrypted.

## 10. Troubleshooting

- Certificate warning: expected for LAN self-signed certs; install the private CA or use a trusted certificate.
- Images/CSS 404 on a hosted site: verify root folder and relative paths.
- Same IP for all frp users: TCP tunnels omit X-Forwarded-For; use HTTP/HTTPS and enable trust-proxy.
- Update check fails: verify `system.updateRepo` and access to `api.github.com`.

---

# 技术实现 / Implementation

## Architecture

- Electron main process owns the local HTTP service and SQLite database; the admin GUI is a sandboxed renderer.
- Express 5 serves `/api/*`, `/host/:username/*`, plugin routes, and the Web client; `better-sqlite3` uses prepared statements throughout.
- File access goes through `safePath`: NFC normalization, control/Windows-invalid-character rejection, reserved-device rejection, `path.relative` containment, realpath checks, symlink/junction rejection.
- CSRF: double-submit cookie + `x-csrf-token`; all mutating routes require it. Sessions are HttpOnly cookies.
- Passwords use scrypt; secrets use AES-256-GCM with `ai-secret.key`.
- Static hosting sets a restrictive CSP (`connect-src 'none'`, `form-action 'none'`, no popups) so hosted HTML cannot call the main API.
- Plugins run via forked child processes with a constrained router; host reads preview files through safePath and passes content to the plugin, never an absolute path.
- Updates use a cached GitHub Releases service (12h) and only open a browser link.
- Web/Admin UIs use React 19 + i18next; the release build is bundled by Vite and packaged by electron-builder/NSIS.

## Build and verification

```bash
npm ci
npm run typecheck
npm test
npm run dist:win
```

Security checks include `scripts/pentest.ts` (traversal, CSRF, lockout, XSS, hosting isolation), integration tests for hosting/CSP, and Electron/Web E2E.
