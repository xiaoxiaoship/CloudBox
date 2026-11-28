# CloudBox 开发与交接指南

> 适用版本：v1.0.3  
> 目标读者：后续接手开发、构建、发布和排障的维护者

## 1. 项目形态

CloudBox v1.0.3 有两种运行形态，共用同一套 `core/services` 和 SQLite：

```text
Electron GUI
├── Electron 主进程
├── preload / IPC
├── 用户 Web
└── 不启动管理员 Web

Headless / Web Admin
├── src/server-entry 单 Node 进程
├── admin Express :1250
├── 用户 Web（由 server.online 控制）
└── frpc（可选）
```

关键边界：

- Electron 不启动 1250。
- 管理 Web 固定 1250，不能作为 frp localPort。
- 管理 Web 默认仅内网访问，且没有内置 HTTPS。
- 管理 Session 固定 4 小时，独立于用户 Session。
- 用户 Web 与管理 Web 的 Cookie、CSRF、CSP 分离。

## 2. 目录结构

```text
src/
├── core/           领域模型、SQLite、服务、迁移
├── server/         用户 Web Express
├── admin-server/   管理 Web Express、路由、中间件
├── server-entry/   headless 启动、初始化 token、服务控制、更新
├── main/           Electron 主进程、IPC、窗口、CA、frp、更新
├── preload/        contextBridge
├── shared/         IPC 类型、语言包、共享常量
admin/              管理前端（GUI/Web 共用）
web/                用户前端
resources/          图标、二进制、卸载 helper
installer/          Inno Setup + WinSW
scripts/            构建、E2E、打包、staging、NSIS patch
tests/              单元/集成/E2E
docs/               配置、架构、插件、审计、交接
```

## 3. 数据目录

| 形态 | 默认目录 |
|---|---|
| Electron | `%APPDATA%\cloudbox` |
| Headless / Server | `%PROGRAMDATA%\CloudBox` |

自定义路径配置文件：

```text
GUI:    %APPDATA%\cloudbox\cloudbox-paths.json
Server: %PROGRAMDATA%\CloudBox\cloudbox-paths.json
```

字段：

```json
{
  "dataDir": "...",
  "storageDir": "...",
  "pluginsDir": "..."
}
```

修改后的实际数据目录不一定在默认路径下。卸载器会读取该文件，只有明确选择删除数据或使用 `/DELETEAPPDATA` 时才删除自定义目录。

## 4. 构建与测试

```bash
npm install
npm run typecheck
npm test
npm run build:web
npm run build:admin
npm run build:headless
npm run build:desktop
```

桌面安装包：

```bash
npm run dist:win
```

Server 安装包：

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-server.ps1
```

Server 构建流程：

```text
build:web → build:admin → build:headless（含 migrations）
→ scripts/prepare-server-stage.mjs
→ npm prune --omit=dev
→ Inno Setup 编译
```

注意：`dist/headless` 必须包含 `dist/headless/migrations`。缺少时 Server 启动会报迁移目录不存在。

## 5. 自动更新

代码：

```text
src/core/services/updateService.ts
src/core/services/updateManager.ts
src/main/updateInstaller.ts
src/server-entry/updateInstaller.ts
admin/src/components/UpdateDialog.tsx
```

流程：

```text
GitHub Release API
→ 选择 CloudBox-Setup / CloudBox-Server
→ 下载到临时目录（进度）
→ 大小 + SHA-256 digest 校验
→ 自动静默安装
→ GUI 重启 / Server 服务重启
```

当前状态：

- 下载、进度、SHA 校验和状态机有自动化测试。
- **真实旧版本→新版本的端到端安装/重启尚未验证。**
- 发布说明和 README 必须保留此限制，不能写成“已验证自动更新”。

## 6. 卸载

### 交互

- Electron NSIS：提示是否删除用户数据。
- Server Inno：提示是否删除用户数据。

### Server CLI

```powershell
# 保留数据
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART

# 删除默认和 cloudbox-paths.json 中的自定义数据目录
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DELETEAPPDATA
```

### 自定义路径删除 helper

```text
resources/uninstall-cleanup.ps1
```

安全规则：

- 拒绝磁盘根目录。
- 拒绝 Windows / Program Files / ProgramData / AppData / UserProfile / 安装目录。
- 拒绝默认路径的祖先目录。
- 删除前停止 CloudBox 服务。
- 默认路径兜底清理。

## 7. 安全不变量

修改代码时不要破坏：

- `safePath` 文件路径边界。
- 管理 Web 独立 `admin_sessions` + `admin_sid` / `admin_csrf`。
- 登录 CSRF。
- 管理员 Session 4 小时。
- 管理员 Web 1250 不映射 frp。
- 用户 Web 与管理 Web 的 Cookie/CSP/CSRF 隔离。
- 审计写入不触发额外邮件事件。
- 设置默认值、迁移版本、密码策略、Cookie 属性不要静默改变。

## 8. 已知限制

- 管理 Web 没有内置 HTTPS，默认只适合内网。
- 无管理员登录失败锁定 / TOTP（产品决策）。
- 自动更新真实安装未验证。
- Desktop NSIS 的卸载询问依赖 `scripts/patch-nsis-uninstaller.mjs` 注入；不要删除该步骤。
- Inno staging 使用短临时路径，避免 Windows 长路径导致 Inno 失败。
- 存量 Settings/Network/Files 等页面仍有硬编码文案，见 `docs/AUDIT-v1.0.3.md`。

## 9. 发布流程

1. `npm run typecheck`
2. `npm test`
3. `npm run build:web`
4. `npm run build:admin`
5. `npm run build:headless`
6. `npm run dist:win`
7. `installer\build-server.ps1`
8. 复制 exe + blockmap + latest.yml + SHA256SUMS 到发布目录
9. 更新 `docs` / Release notes
10. 用户确认后再 push / release

不要在上传前重新生成未测试的 assets。

## 10. 排障

### Server 服务启动即停止

查看：

```text
%PROGRAMDATA%\CloudBox\logs\CloudBoxService.err.log
```

常见原因：

- `dist/headless/migrations` 缺失。
- 端口 1250 被占用。
- 数据目录权限不足。
- native 模块版本不匹配。

### 覆盖安装文件被占用

Inno `PrepareToInstall` 会停止 CloudBox 服务；如果手工覆盖，先：

```powershell
Stop-Service CloudBox
```

### NSIS 卸载不弹窗

确认 `package.json` 的 `dist:win` 包含：

```text
node scripts/patch-nsis-uninstaller.mjs
```

并清理：

```text
release\win-unpacked
release\CloudBox-Setup-*-__uninstaller.exe
```

后重新打包。

### Inno 报“系统找不到指定的路径”

检查 staging 是否位于短路径 `%TEMP%\CloudBoxStage`，并确认 Inno 通过 `/DStageDir=...` 使用它。

---

# English

## CloudBox Development and Handover Guide

> Applies to version: v1.0.3  
> Intended audience: maintainers who will take over development, builds, releases, and troubleshooting

### 1. Project Forms

CloudBox v1.0.3 has two runtime forms, which share the same `core/services` and SQLite:

```text
Electron GUI
├── Electron main process
├── preload / IPC
├── User web
└── Does not start admin web

Headless / Web Admin
├── src/server-entry single Node process
├── admin Express :1250
├── User web (controlled by server.online)
└── frpc (optional)
```

Key boundaries:

- Electron does not start 1250.
- The admin Web is fixed at 1250 and cannot be used as the frp localPort.
- The admin Web is intranet-only by default and has no built-in HTTPS.
- The admin Session is fixed at 4 hours and is independent of the user Session.
- Cookies, CSRF, and CSP are separated between the user Web and the admin Web.

### 2. Directory Structure

```text
src/
├── core/           domain models, SQLite, services, migrations
├── server/         user web Express
├── admin-server/   admin web Express, routes, middleware
├── server-entry/   headless startup, init token, service control, updates
├── main/           Electron main process, IPC, windows, CA, frp, updates
├── preload/        contextBridge
├── shared/         IPC types, locales, shared constants
admin/              admin frontend (shared by GUI/Web)
web/                user frontend
resources/          icons, binaries, uninstall helper
installer/          Inno Setup + WinSW
scripts/            build, E2E, packaging, staging, NSIS patch
tests/              unit/integration/E2E
docs/               configuration, architecture, plugins, audit, handover
```

### 3. Data Directories

| Form | Default directory |
|---|---|
| Electron | `%APPDATA%\cloudbox` |
| Headless / Server | `%PROGRAMDATA%\CloudBox` |

Custom path configuration file:

```text
GUI:    %APPDATA%\cloudbox\cloudbox-paths.json
Server: %PROGRAMDATA%\CloudBox\cloudbox-paths.json
```

Fields:

```json
{
  "dataDir": "...",
  "storageDir": "...",
  "pluginsDir": "..."
}
```

The actual data directory after modification is not necessarily under the default path. The uninstaller reads this file, and deletes a custom directory only when the user explicitly chooses to delete data or uses `/DELETEAPPDATA`.

### 4. Build and Test

```bash
npm install
npm run typecheck
npm test
npm run build:web
npm run build:admin
npm run build:headless
npm run build:desktop
```

Desktop installer:

```bash
npm run dist:win
```

Server installer:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-server.ps1
```

Server build flow:

```text
build:web → build:admin → build:headless (including migrations)
→ scripts/prepare-server-stage.mjs
→ npm prune --omit=dev
→ Inno Setup compile
```

Note: `dist/headless` must contain `dist/headless/migrations`. If it is missing, Server startup reports that the migrations directory does not exist.

### 5. Auto-Update

Code:

```text
src/core/services/updateService.ts
src/core/services/updateManager.ts
src/main/updateInstaller.ts
src/server-entry/updateInstaller.ts
admin/src/components/UpdateDialog.tsx
```

Flow:

```text
GitHub Release API
→ select CloudBox-Setup / CloudBox-Server
→ download to temp directory (progress)
→ size + SHA-256 digest verification
→ automatic silent install
→ GUI restart / Server service restart
```

Current status:

- Download, progress, SHA verification, and the state machine have automated tests.
- **End-to-end installation/restart from a real old version to a new version has not yet been verified.**
- Release notes and the README must retain this limitation and must not claim that auto-update is "verified".

### 6. Uninstall

#### Interaction

- Electron NSIS: prompts whether to delete user data.
- Server Inno: prompts whether to delete user data.

#### Server CLI

```powershell
# Keep data
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART

# Delete defaults and custom data paths recorded in cloudbox-paths.json
unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DELETEAPPDATA
```

#### Custom-path Deletion Helper

```text
resources/uninstall-cleanup.ps1
```

Safety rules:

- Refuses disk root directories.
- Refuses Windows / Program Files / ProgramData / AppData / UserProfile / the install directory.
- Refuses ancestor directories of the default path.
- Stops the CloudBox service before deletion.
- Performs fallback cleanup of the default path.

### 7. Security Invariants

Do not break the following when modifying code:

- The `safePath` file path boundary.
- The admin Web's independent `admin_sessions` + `admin_sid` / `admin_csrf`.
- Login CSRF.
- The 4-hour admin Session.
- Admin Web 1250 is not mapped through frp.
- Cookie/CSP/CSRF isolation between the user Web and the admin Web.
- Audit writes do not trigger extra email events.
- Do not silently change settings defaults, migration versions, password policy, or Cookie attributes.

### 8. Known Limitations

- The admin Web has no built-in HTTPS and is suitable for intranet use only by default.
- No admin login failure lockout / TOTP (product decision).
- Real-world auto-update installation is not verified.
- The Desktop NSIS uninstall prompt depends on injection by `scripts/patch-nsis-uninstaller.mjs`; do not remove that step.
- Inno staging uses a short temporary path to avoid Inno failures caused by Windows long paths.
- Existing pages such as Settings/Network/Files still contain hardcoded text; see `docs/AUDIT-v1.0.3.md`.

### 9. Release Process

1. `npm run typecheck`
2. `npm test`
3. `npm run build:web`
4. `npm run build:admin`
5. `npm run build:headless`
6. `npm run dist:win`
7. `installer\build-server.ps1`
8. Copy the exe + blockmap + latest.yml + SHA256SUMS to the release directory
9. Update `docs` / Release notes
10. Push / release only after user confirmation

Do not regenerate untested assets before uploading.

### 10. Troubleshooting

#### Server Service Stops Immediately After Starting

Check:

```text
%PROGRAMDATA%\CloudBox\logs\CloudBoxService.err.log
```

Common causes:

- `dist/headless/migrations` is missing.
- Port 1250 is in use.
- Insufficient permissions on the data directory.
- Native module version mismatch.

#### Files in Use During Overwrite Installation

Inno `PrepareToInstall` stops the CloudBox service; if overwriting manually, first run:

```powershell
Stop-Service CloudBox
```

#### NSIS Uninstall Shows No Prompt

Confirm that `dist:win` in `package.json` includes:

```text
node scripts/patch-nsis-uninstaller.mjs
```

And after cleaning up:

```text
release\win-unpacked
release\CloudBox-Setup-*-__uninstaller.exe
```

repackage.

#### Inno Reports "The System Cannot Find the Path Specified"

Check whether staging is located at the short path `%TEMP%\CloudBoxStage`, and confirm that Inno uses it via `/DStageDir=...`.
