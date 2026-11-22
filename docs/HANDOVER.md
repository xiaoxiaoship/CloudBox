# CloudBox 开发与交接指南

> 适用版本：v1.0.2  
> 目标读者：后续接手开发、构建、发布和排障的维护者

## 1. 项目形态

CloudBox v1.0.2 有两种运行形态，共用同一套 `core/services` 和 SQLite：

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
- 存量 Settings/Network/Files 等页面仍有硬编码文案，见 `docs/AUDIT-v1.0.2.md`。

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
