# CloudBox

本地多用户网盘：Electron 桌面管理端 + Express 用户 Web 端 + SQLite 单文件存储。
当前处于 **阶段 2：核心后端与数据层**。

## 环境要求

- Node.js **>= 22.18**（本机验证版本：26.13.0）。项目直接使用 Node 原生的 TypeScript 类型剥离运行 `.ts`，
  无需 ts-node / tsx；`tsc` 仅做类型检查。
- npm（本机：11.20.0）
- `better-sqlite3@13` 使用 **N-API 预编译二进制**，安装时不需要 Python / MSVC。若你的环境缺少预编译包，
  才需要安装 Visual Studio Build Tools（C++ 工作负载）与 Python 3。

## 快速开始

```bash
npm install
npm run dev:server
```

启动后访问：

```bash
curl http://127.0.0.1:8686/health
```

预期返回：

```json
{
  "status": "ok",
  "service": "cloudbox",
  "version": "0.1.0",
  "uptimeSeconds": 3,
  "database": "ok",
  "time": "2026-11-06T16:59:26.600Z"
}
```

## npm scripts

| 脚本 | 作用 |
|---|---|
| `npm run dev:server` | 以 `--watch` 启动服务，改代码自动重启 |
| `npm run start:server` | 生产式启动（无 watch） |
| `npm run typecheck` | TypeScript 全量类型检查（`tsc --noEmit`） |
| `npm test` | Node 内置测试运行器，跑 `tests/**/*.test.ts` |
| `npm run test:watch` | 测试 watch 模式 |
| `npm run seed:admin` | 交互式创建初始管理员（密码不回显、不落盘） |
| `npm run seed:admin:reset` | 重置管理员密码、解锁账户、强制下线所有会话 |
| `npm run dev:web` | Vite 开发服务器（5173，`/api` 代理到 8686） |
| `npm run build:web` | 类型检查 + 构建用户 Web 端到 `dist/web` |
| `npm run typecheck:web` | 前端 TypeScript 检查 |
| `npm run preview:web` | 预览 Vite 构建产物 |
| `npm run e2e:web` | Playwright + 本机 Edge 的真实浏览器 E2E |
| `npm run e2e:web:features` | 视频预览 + 分享直链 UI E2E |
| `npm run e2e:web:register` | 公开注册开关与注册流程 UI E2E |
| `npm run e2e:web:security` | 功能权限 / 安全解压 / 查杀 UI E2E |
| `npm run e2e:web:ai` | AI 悬浮球 / 流式对话 / 工具调用 / 5 秒防误触 E2E |
| `npm run e2e:web:hosting` | 静态托管部署 / 访问 / 私有拦截 E2E |
| `npm run e2e:web:audio` | 音频悬浮播放器 / 播放列表 E2E |
| `npm run e2e:web:i18n` | 中英切换 / localStorage 持久化 E2E |
| `npm run e2e:electron:plugins` | 插件导入/启用、iframe 配置页、CSS 注入 E2E |
| `npm run build:admin` | 类型检查 + 构建管理员 React 界面到 `dist/admin` |
| `npm run build:main` | esbuild 打包 Electron 主进程与 preload |
| `npm run build:desktop` | 构建管理员界面 + 主进程 |
| `npm run electron:start` | 直接启动 Electron（需先 build） |
| `npm run electron:dev` | 构建后启动 Electron |
| `npm run electron:rebuild` | 强制重编译 better-sqlite3（非 N-API 环境备用） |
| `npm run e2e:electron` | Electron 管理端真实窗口 E2E |
| `npm run e2e:electron:network` | 私有 CA / HTTPS / mTLS / frp / 改密 / 备份 E2E |
| `npm run e2e:electron:directories` | 系统数据目录 / 网盘文件目录 / 插件目录迁移 E2E |
| `npm run dist:win` | 构建 Web + 管理端 + 主进程并生成 NSIS/便携版 |

## 桌面端（Electron）

```bash
npm run build:desktop
npm run electron:start
```

> 请通过 `npm run electron:start` 启动；包装脚本会清除可能存在的
> `ELECTRON_RUN_AS_NODE=1`，否则 Electron 会被当作纯 Node 运行。

- **首次运行**：数据目录没有管理员时，窗口直接进入“创建管理员”向导；密码使用 scrypt 哈希保存。
- **默认离线**：启动时不监听任何端口；只有打开“在线模式”开关才启动内嵌 Express，关闭即停止。
- **数据目录**：默认 `%APPDATA%/CloudBox`（`cloudbox.db`、`storage/`、`config/ssl/`、`config/frpc.toml`）；插件目录默认
  `%APPDATA%/CloudBox/plugins`。路径配置保存在 userData 的 `cloudbox-paths.json`。系统数据目录、网盘文件目录与插件目录可分别修改：
  - “仅改路径”：不移动旧数据；storage 会按现有用户初始化空目录
  - “迁移数据”：停服务后复制数据库/配置或 storage，更新配置并自动重启
- **根证书自助下载**：开启 HTTPS 且已生成私有 CA 时，普通用户登录页显示
  “💡 首次访问遇到安全警告？请点击下载并安装根证书”，直接下载 `/api/public/root-ca.crt`。
- **内置 HTTPS**：网络设置页切换 HTTP/HTTPS；导入 `.crt/.pem/.cer` 与 `.key/.pem` 到 `config/ssl/`，
  启用前用 `tls.createSecureContext` 校验证书与私钥是否匹配；HTTPS 使用 `https.createServer`（TLS 1.2+）。
  局域网自签证书会触发浏览器警告，公网请使用正式证书。
- **一键私有 CA**：基于 `@mkcert/node` 的 caroot 机制生成独立 CA（`config/ssl/ca/`），可一键安装/卸载
  系统信任库、签发服务端证书（`config/ssl/server/` 并复制到活动路径），并导出 AES-256 PKCS#12 客户端证书
  （密码 `changeit`）。CA 可开启可选 mTLS，浏览器需导入客户端证书才能访问。手动导入证书与一键生成互不冲突。
- **frp 穿透**：随包附带 frpc v0.72.0（Apache-2.0）。管理端生成 `frpc.toml`，支持
  HTTP/HTTPS 隧道（frps 注入 `X-Forwarded-For`）与 TCP 隧道（可选 PROXY protocol v2）；
  `child_process.spawn` 托管进程，捕获 stdout/stderr，支持启动/停止/热重载。
- **信任反向代理**：网络设置页提供 `network.trustProxy` 开关。开启后 Express 使用
  `trust proxy = 1` 从 `X-Forwarded-For` 解析 `req.ip`，限流按真实客户端 IP 计数；默认关闭。
- **网络增强**：展示本地与局域网访问地址，生成手机可扫的二维码；管理员可在系统设置中改密、
  导出 SQLite 在线备份（`db.backup`）。
- **托盘**：关闭窗口默认隐藏到系统托盘；托盘右键菜单可重新打开或退出；退出时先关闭 HTTP 服务与数据库。
- **安全边界**：
  - `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、禁用 `webSecurity` 降级
  - preload 只通过 `contextBridge` 暴露 `auth/users/server/files/frp/ca/app` 白名单方法
  - 管理员会话 token 仅存主进程内存；渲染层无法访问 `ipcRenderer`
  - 每个 IPC 调用校验 sender frame、zod 入参、管理员会话与角色
  - 离线文件浏览强制复用 `resolveUserPath`，只读且记录审计
- **原生模块**：`better-sqlite3@13` 使用 N-API 预编译二进制，在 Electron 45 / Node 24.22 / N-API 10 下
  已实测直接加载（SQLite 3.53.4），无需 MSVC/Python。`electron:rebuild` 已配置，供非 N-API 环境使用；
  打包配置中设置 `npmRebuild: false`，避免无工具链机器打包失败。
- **打包**：

```bash
npm run dist:win
```

输出（`release/`）：

- `CloudBox-Setup-0.1.0-x64.exe` — 约 155.3 MB（NSIS 安装包）
- `CloudBox-Portable-0.1.0-x64.exe` — 约 140.3 MB（便携版）
- `win-unpacked/CloudBox.exe` — 已实测可运行（含 `resources/bin/frpc.exe`、`mkcert.exe` 与 `7za.exe`）

未配置代码签名，Windows SmartScreen 可能提示未知发布者。

## frp 部署指南

- 在“网络设置 → frp 内网穿透”中填写 frps 地址、端口、token 与代理名称。
- **HTTP / HTTPS 隧道**：填写自定义域名，`type = "http"` 或 `"https"`；frps 会自动注入
  `X-Forwarded-For`。静态托管与主界面共用端口，生成配置会写入
  `locations = ["/", "/host"]`，不要再为托管单独开 TCP 端口。
- **TCP 隧道**：填写公网映射端口；TCP 本身不携带 `X-Forwarded-For`。仅当本地服务支持时，
  可勾选 PROXY protocol v2（Express 默认不解析该协议）。
- 保存配置时若 frpc 正在运行，会自动重启实现热重载。
- **重要**：挂载 frp 后，请务必在管理员面板开启“信任反向代理真实 IP”开关，否则所有用户将共享
  `127.0.0.1` 的限流额度。若端口直接暴露在公网，请保持该开关关闭，避免伪造 IP 头绕过限流。

## 配置

复制 `.env.example` 为 `.env` 后修改（`.env` 已被 gitignore）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8686` | 监听端口，1024–65535 |
| `BIND` | `0.0.0.0` | `0.0.0.0` 局域网可访问，`127.0.0.1` 仅本机 |
| `DATA_DIR` | `./data` | 数据库、用户文件根目录 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

数据目录结构：

```
data/
├─ cloudbox.db (+ -wal / -shm)   # WAL 模式
└─ storage/                      # 每个用户一个 storage_key 子目录
```

## 用户 Web 端

### 开发模式（热更新）

```bash
# 终端 1
npm run dev:server

# 终端 2
npm run dev:web
```

打开 `http://localhost:5173`。Vite 已将 `/api` 代理到 `http://127.0.0.1:8686`，无需处理跨域。

### 生产模式（单一端口）

```bash
npm run build:web
npm run start:server
```

打开 `http://localhost:8686`。Express 会自动托管 `dist/web`，并为 SPA 下发 CSP
（`script-src 'self'`、`worker-src 'self'` 等）；未构建前端时只提供 API。

### 浏览器 E2E

```bash
# 先启动后端与前端（开发模式或生产模式均可）
npm run e2e:web

# 也可指定生产构建
WEB_URL=http://127.0.0.1:8686 npm run e2e:web
```

E2E 使用本机 Edge（`playwright-core`，不下载 Chromium），覆盖登录、建目录、上传进度、
文本/图片/PDF 预览、重命名、删除、移动端布局、浅色/深色/跟随系统切换，并把截图写入 `artifacts/`。

### 深色模式

- 三态切换：浅色 / 深色 / 跟随系统，位于登录页右上角与文件页 Header
- 偏好写入 `localStorage`（`cloudbox-theme`），刷新后由 `web/public/theme-init.js` 在首屏渲染前恢复，无白屏闪烁
- 选择“跟随系统”时监听 `prefers-color-scheme`，系统外观变化立即生效
- 多标签页通过 `storage` 事件同步主题
- Tailwind v4 已移除 JS 配置里的 `darkMode` 开关，等价写法是在 `web/src/styles.css` 中声明
  `@custom-variant dark (&:where(.dark, .dark *));`，由 `<html class="dark">` 驱动，行为与 `darkMode: 'class'` 一致

## 已实现（阶段 2A + 2B + 3 + 3.5 + 4 + 5 + 私有 CA + 视频/分享）

- **工程骨架**：`package.json`、严格模式 `tsconfig.json`、`.gitignore`、`.env.example`
- **数据库层**：`connection.ts`（WAL / foreign_keys / busy_timeout）、`migrator.ts`（事务化、幂等、防降级）、
  `001_init.sql`（6 张表 + 索引 + 默认设置）、`002_shares.sql`（带时效分享直链表）
- **仓储层**：`UserRepository` / `QuotaRepository` / `SessionRepository` / `SettingsRepository` / `AuditRepository` / `ShareRepository`
- **认证**：scrypt 哈希、dummy 派生抗枚举、指数退避锁定、会话签发/校验/轮换/吊销、改密/重置
- **文件服务**：
  - 列目录 / 新建目录 / 重命名 / 删除 / 流式下载，全部经 `resolveUserPath`
  - 用户根目录按 `storage_key` 隔离，跨用户路径穿越直接拒绝
  - 删除目录递归统计实际大小并回退配额
- **上传管线**：
  - busboy 流式解析 → 临时文件 → Transform 边写边计数 → 超限立即断流
  - 用户级串行锁（`KeyedMutex`）防并发超卖
  - 配额事务更新 → 原子 `rename` 落位，失败自动补偿
  - 客户端中断自动清理临时文件；启动时清空 `tmp/uploads`
- **HTTP API**：登录/登出/me、文件列表/目录/重命名/删除/上传/下载（Range）、预览（info/content）
- **安全中间件**：HttpOnly 会话 Cookie、Double-submit CSRF、三档限流、统一错误码、denied 审计
- **下载**：`createReadStream` + `pipeline` 全程流式，支持单段 Range，强制 `Content-Disposition: attachment`
- **预览安全**：
  - 图片：扩展名 + 魔数双重白名单，`nosniff`，SVG 不在白名单
  - 文本：服务端 512KB 截断 + 编码识别（UTF-8 严格校验优先，chardet/iconv-lite 兜底），JSON 返回，前端 `<pre>` 渲染
  - PDF：`application/pdf` + inline + CSP sandbox，前端使用 `pdfjs-dist` 渲染到 Canvas
  - 视频：mp4 / webm / ogg 白名单，`video/mp4` 等 MIME + inline，复用单段 Range（206），前端原生 `<video controls preload="metadata">`
  - HTML / SVG / 其他格式：415，只允许下载
- **安全分享直链**：
  - `shares` 表保存 token、user_id、storage_key 快照、file_path、expires_at、created_at
  - `POST /api/shares` 需登录 + CSRF，时长严格限制 30–7200 秒，每用户 10 次/分钟
  - `GET /api/public/s/:token` 无需登录，过期返回 410，复用 safePath 与 Range 流式下载
  - 前端文件操作菜单“分享直链”，时长下拉、一键复制、风险提示
- **用户 Web 端**：React 19 + Vite 8 + Tailwind 4 + Zustand；登录页、面包屑、多选、配额条、
  拖拽上传（XHR 实时进度）、重命名/删除二次确认、响应式移动端
- **深色模式**：浅色 / 深色 / 跟随系统三态、localStorage 持久化、首屏无闪烁、系统外观监听、跨标签同步
- **Electron 管理端**：
  - 单进程双角色：主进程内嵌 Express，默认离线；一键启停在线模式
  - 首次运行向导、管理员登录、用户创建/配额/重置密码/禁用/解除锁定/删除
  - 端口修改与冲突处理；在线状态下自动重启并在失败时回滚旧端口
  - 离线文件浏览：只读、按用户隔离、复用 safePath，支持另存为下载
  - 托盘常驻、关闭窗口最小化、托盘菜单退出、退出时关闭服务与数据库
  - IPC 白名单 + sender 校验 + zod + 主进程管理员会话；`sandbox/contextIsolation/nodeIntegration` 全部收紧
  - Electron 45 + better-sqlite3 N-API 直接兼容；electron-builder 输出 NSIS 与 portable
- **HTTPS / 网络补全**：
  - HTTP/HTTPS 切换、证书/私钥导入与配对校验、`https.createServer`（TLS 1.2+）
  - 一键生成私有 CA、安装/卸载系统信任库、签发服务端证书
  - 导出 AES-256 PKCS#12 客户端证书（密码 `changeit`），可选 mTLS 双向认证
  - 登录页公开下载根证书（仅 HTTPS + 私有 CA 时显示）
  - frpc v0.72.0 子进程托管、HTTP/HTTPS/TCP 隧道、日志采集、启动/停止/配置热重载
  - 信任反向代理真实 IP 开关（X-Forwarded-For 限流）
  - 局域网地址 + 手机扫码二维码
  - 系统数据目录/网盘文件目录独立修改，支持“仅改路径”和“迁移数据”两种模式
  - 管理员改密（强制下线）、SQLite 数据库在线备份
- **用户网页自助注册**：
  - 管理员系统设置开关，配置键 `allow_public_registration`，默认关闭
  - 公开探测 `GET /api/public/settings`；注册 `POST /api/auth/register`
  - 用户名 3-20 位字母数字、密码至少 8 位；scrypt 哈希、5GB 默认配额
  - 每 IP 每小时最多 2 次成功注册；注册后无需重启即可登录
- **细粒度功能权限**：
  - `allow_user_preview_image` / `video` / `pdf`
  - `allow_user_extract` / `allow_user_scan`
  - `GET /api/public/settings` 暴露给 Web；关闭时前端隐藏入口，后端接口返回 403
- **安全在线解压**：
  - `node-7z` + `7zip-bin`，`POST /api/files/extract` 返回 `202 { taskId }`
  - 解压前用 7z 列出全部条目，逐条调用 safePath；`../`、绝对路径、符号链接和已存在目标一律拒绝
  - 任务异步执行、失败清理、成功后计入配额
- **双模式云查杀**：
  - `scan.enabled` / `scan.mode` / `scan.api_key` / `scan.local_path`
  - API 模式使用 VirusTotal（SHA-256，>32MB 拒绝）；本地模式调用 ClamAV
  - `POST /api/files/scan` 异步任务；`GET /api/tasks/:taskId` 轮询
  - `file_scans` 持久化结果，infected 文件下载/分享/解压强制 403
- **账号解锁**：管理员可单独清除 `failed_attempts` 与 `locked_until`，不修改密码；写入 `user.unlock` 审计
- **插件平台**：
  - 管理端“插件”页支持 zip/文件夹导入、启用/禁用、卸载与独立子进程生命周期
  - `child_process.fork` 运行插件 `index.js`；主进程绝不 `require` 插件代码
  - `ctx.registerRouter` / `ctx.on` / `ctx.storage` / `ctx.logger`；插件 API 挂载到 `/api/plugins/{name}/`
  - 插件可提供 `admin-ui/index.html`（`plugin-admin://` 沙箱 iframe）、`web-theme.css`（CSS 注入）与 `web-override/`（完整接管，需红色高危确认）
  - 插件目录默认 `%APPDATA%/CloudBox/plugins`，支持“仅改路径”和“迁移数据”
  - 开发文档：[docs/PLUGIN_API.md](docs/PLUGIN_API.md)；示例：[resources/plugins/ai-summary](resources/plugins/ai-summary)、[resources/plugins/dark-neon-theme](resources/plugins/dark-neon-theme)
- **原生 AI 助手**：
  - 管理员共享 `admin` 模式或用户自填 `user` 模式；API Key AES-256-GCM 加密落盘、脱敏展示
  - Web 悬浮球 / Markdown / SSE 流式输出 / 5 秒全盘权限防误触
  - ReAct + Function Calling：列表、读取、建目录、重命名、删除、写入/追加文本
  - 覆盖或删除返回 `require_confirmation` 与 `actionId`，确认后执行
- **原生 MCP Server**：
  - `@modelcontextprotocol/sdk` Streamable HTTP `/api/mcp`
  - Bearer Token 鉴权；Token 绑定用户网盘根目录
  - 复用 safePath 与工作目录边界；绝对路径和 `../` 一律拒绝
  - 与 AI 相同工具集，高危操作审计；管理端生成配置模板
- **DSH 对接插件**：[dsh-plugin-cloudbox](dsh-plugin-cloudbox)
  - `inject: ['tools']`，拉取 CloudBox MCP 工具并注册给 DSH
  - 强制 System Prompt 注入网盘相对路径约束
  - 独立 TypeScript 工程，`npm install && npm run build`
- **内嵌静态托管**：
  - `/host/{username}/` 单端口托管，不额外映射公网端口
  - 用户选择网盘文件夹作为站点根目录；公开或私有访问
  - SPA 回退、正确 Content-Type、CSP sandbox、safePath 防穿越
  - frp HTTP/HTTPS 使用 `locations = ["/", "/host"]` 复用同一隧道
- **系统邮件告警**：
  - 管理员 SMTP 配置（host/port/TLS/user/pass/from/to），密码 AES-256-GCM 加密落盘并脱敏展示
  - 订阅新用户注册、安全告警、系统错误
  - nodemailer 异步发送；同一告警 1 分钟内冷却防抖，发送失败只记日志
  - 管理端提供测试邮件按钮
- **原生音乐播放器**：
  - MP3/WAV/OGG/FLAC/AAC/M4A 音频预览，HTTP Range 拖拽
  - 全局底部悬浮播放器、播放列表、上一首/下一首、音量与进度
  - 切换目录/页面不中断；点击音频自动加载当前目录播放列表
- **中英双语 i18n**：
  - Web 与管理员 Electron GUI 统一 i18next/react-i18next
  - `zh-CN` / `en-US` 模块化语言包；语言切换持久化到 localStorage
  - 登录页、Header、管理端导航、AI 助手等主要入口已接入
  - 后端错误码映射当前语言；英文界面下 AI System Prompt 追加 `Please reply to the user in English.`
- **用户头像**：
  - Web 用户点击 Header 头像即可上传 PNG/JPEG/WebP（≤600KB）
  - 头像存储在 SQLite `users.avatar_data`，随会话返回
  - 管理端用户列表显示头像缩略图
- **测试**：132 个后端用例 + Playwright 浏览器 E2E + 视频/分享/注册/安全/AI/托管/音频/i18n UI E2E + Electron 基础 E2E + 插件 E2E + Electron 私有 CA/HTTPS/mTLS/frp E2E + 目录迁移 E2E

## 目录结构

```
src/
├─ core/
│  ├─ container.ts                 # 领域服务装配
│  ├─ db/
│  │  ├─ connection.ts
│  │  ├─ migrator.ts
│  │  ├─ migrations/001_init.sql
│  │  ├─ migrations/002_shares.sql
│  │  ├─ migrations/003_scans.sql
│  │  ├─ migrations/004_plugins.sql
│  │  └─ repositories/{user,quota,session,settings,audit,share,scan,plugin}Repo.ts
│  ├─ fs/keyedMutex.ts
│  ├─ security/{password,safePath,sessionToken}.ts
│  ├─ services/{auth,settings,audit,file,adminUser,share,registration,scan,extraction,task,plugin}Service.ts
│  └─ types/models.ts
├─ main/                          # Electron 主进程
│  ├─ index.ts                    # 生命周期 / 窗口 / 托盘 / 单实例
│  ├─ context.ts                  # 数据目录 + 领域服务装配
│  ├─ ipc.ts                      # IPC 白名单、sender 校验、管理员会话
│  ├─ adminSession.ts
│  ├─ serverController.ts         # HTTP/HTTPS 启动/停止/端口
│  ├─ tlsManager.ts               # 证书导入、解析与配对校验
│  ├─ caManager.ts                # 私有 CA、签发、mTLS 客户端导出
│  ├─ pathConfig.ts               # userData 中的路径配置
│  ├─ directoryMigration.ts       # 数据/存储目录迁移与重启
│  ├─ frpService.ts               # frpc 子进程与日志
│  └─ tray.ts
├─ preload/index.ts               # contextBridge 白名单
├─ shared/{logger,version,ipcTypes}.ts
└─ server/
   ├─ app.ts                       # Express 组装 + dist/web 静态托管
   ├─ config.ts                    # 环境变量校验
   ├─ index.ts                     # 启动 / 优雅退出 / 临时目录清理
   ├─ http/{cookies,context,range,contentDisposition,download}.ts
   ├─ middleware/{requestId,requireUser,csrf,rateLimit,errorHandler}.ts
   ├─ routes/{health,auth,files,shares,tasks,plugins}.routes.ts
   ├─ types/express.d.ts
   └─ upload/receiveUpload.ts

admin/                             # 管理员 React 界面（file:// 加载）
├─ index.html
└─ src/{App.tsx,api,lib,components}   # NetworkPage / SettingsPage 等
resources/
├─ icon.png / tray.png
└─ bin/frpc.exe + mkcert.exe + 7za.exe + plugin-child.cjs + LICENSE* + README.md
web/
├─ index.html
├─ public/theme-init.js            # 首屏主题恢复（CSP 友好的外部脚本）
└─ src/
   ├─ api/client.ts                # fetch 封装 + XHR 上传
   ├─ store/useAppStore.ts         # Zustand 状态（含 theme 持久化）
   ├─ components/                  # 登录、文件表、预览、弹窗、上传面板、主题切换
   └─ lib/                         # 格式化、主题、弹窗 hooks
scripts/
├─ seed-admin.ts
├─ e2e-web.ts
├─ e2e-web-features.ts
├─ e2e-web-register.ts
├─ e2e-electron.ts
├─ e2e-electron-network.ts
├─ e2e-electron-directories.ts
├─ build-electron.mjs
└─ make-icons.mjs
tests/
├─ helpers/testServer.ts
├─ unit/{password,safePath,authPolicy,http,keyedMutex}.test.ts
└─ integration/{db,health,repositories,auth,files,preview}.test.ts
```

## 下一步

阶段 6（发布与运维增强）：代码签名、自动更新、证书到期提醒、审计日志管理界面、frp 多代理配置。



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
