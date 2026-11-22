# CloudBox v1.0.2 静态审计报告（只读）

- 审计日期：2026-11-22
- 范围：`src/`、`admin/src/`、`web/src/`、`tests/`、`scripts/`、`installer/`、`build/`
- 原则：**只扫描，不删除代码、不修改依赖**

## 1. 死代码 / 无引用候选

| 项目 | 证据 | 结论 |
|---|---|---|
| `installer/winsw/CloudBox.xml` | 已确认无引用，已删除 | 已清理 |
| `installer/winsw/CloudBoxService.xml` | 被 `installer/inno/CloudBox.iss` 引用 | 保留 |
| `admin/src/components/*.tsx` | 逐个检查 `admin/src` 引用 | 未发现完全无引用的组件 |
| `src/admin-server/routes/*.ts` | 全部由 `src/admin-server/app.ts` 挂载 | 保留 |
| `src/main/directoryMigration.ts` | 被 Electron `appChangeDirectory` 使用 | 保留；Web 使用 `AdminDirectoryService` |
| `build/installer.nsh` | electron-builder NSIS `include` | 保留 |
| `src/main/updateInstaller.ts` | GUI 更新流程使用 | 保留 |
| `src/server-entry/updateInstaller.ts` | Server 更新流程使用 | 保留 |

结论：当前没有发现大面积死代码；只有 `CloudBox.xml` 是明确的旧配置副本候选。

## 2. Admin HTTP 未实现/桌面专属方法

`admin/src/api/http.ts` 仍保留以下 `ADMIN_NOT_IMPLEMENTED`：

```text
app.openDataDir
app.openStorageDir
app.openPluginsDir
```

这些不是业务死代码，而是 Web 不能打开服务器本机资源管理器的能力边界。对应 UI 已禁用或提示。

已从“未实现”移出的能力：

```text
auth.changePassword
users.renameSelf
server.getSchedule / setSchedule
server.importCertificate
ca.exportClientCert
plugins.import
app.changeDirectory
```

## 3. 旧安全双轨字段

当前安全设置同时存在：

### 3.1 简洁模式字段

```text
security.lockEnabled
security.maxLoginFailures
security.lockBaseMinutes
security.lockMaxMinutes
security.ipLoginLimit
security.ipWindowMinutes
security.ipLockMinutes
security.simpleRegisterLimit
security.renameEnabled
security.renameLimit
security.renameWindowHours
security.renameLockHours
security.capEnabled
security.capLoginFailures
security.capRegistrationLimit
security.capShareLimit
```

### 3.2 高级模式策略

```text
security.policy (JSON)
security.policy 内的 rules/savedRules/ipBan/accountBan/globalBan/accessLists
```

### 3.3 共用/边界字段

```text
security.mode
security.sessionTtlHours     用户 Web Session；管理 Web 已固定 4h
security.adminIdleEnabled    管理端前端空闲锁定
security.adminIdleMinutes
security.lowLevel            WAF 之前的硬限制
security.capSecret           Cap 签名密钥
```

结论：这些字段在“按模式分支”下都仍被使用，**不是可以盲目删除的死字段**。风险是：

- `security.sessionTtlHours` 名称看起来像管理 Session，但管理端已不使用它。
- 简洁模式与高级模式对 Cap、注册、改名的语义不同。
- 切换模式会清理旧封禁/计数；旧字段仍保留在设置表中。

建议后续统一为显式的 `simplePolicy` / `advancedPolicy` 命名，或在 UI 中明确标注“仅用户 Web”。

## 4. 无用 npm 依赖候选

扫描 `package.json` 的 dependencies/devDependencies，并与源码 `import/require` 对照。

### 4.1 明确候选

| 依赖 | 证据 | 建议 |
|---|---|---|
| `mime-types` | 已确认无直接引用，已从 `package.json` / lock 删除 | 已清理；`express` 等的传递依赖仍可能存在于 node_modules |
| `@types/mime-types` | 已随 `mime-types` 删除 | 已清理 |

### 4.2 扫描误报，不应删除

以下依赖在源码中没有直接 import，但被构建脚本/配置文件使用：

```text
@electron/rebuild     electron:rebuild 脚本
@tailwindcss/vite     vite/tailwind 配置
electron-builder      dist:win 脚本
tailwindcss           Tailwind 构建
typescript            typecheck / tsc
vite                  web/admin 构建
@types/*              类型检查
```

以下使用子路径或动态 require，扫描器不能直接匹配：

```text
@mertcanureten/node-waf    require('.../lib/rules/builtin.json')
jszip                       tests/helpers/zip.ts
selfsigned                  scripts/e2e-electron-network.ts
```

## 5. i18n 当前状态

### 已补齐的新功能文案

- 更新检查/下载/安装/重启状态
- 管理 Session 列表、刷新、全部注销、当前会话提示
- Web 目录路径提示、占位符、错误提示
- 证书/私钥导入成功提示
- CA 生成/安装/卸载/签发/导出提示
- 插件 ZIP 导入使用现有 `pluginsPage` 文案
- 卸载询问由 Inno Setup / NSIS 双语弹窗处理，不属于 JSON 文案

对应 keys 已写入：

```text
src/shared/locales/zh-CN.json
src/shared/locales/en-US.json
```

### 仍存在的硬编码（历史遗留）

扫描 `admin/src` 后仍有大量中文硬编码，主要集中在：

```text
admin/src/components/SettingsPage.tsx
admin/src/components/NetworkPage.tsx
admin/src/components/FilesPage.tsx
admin/src/components/LowLevelSecurityPanel.tsx
admin/src/components/Dialog.tsx
admin/src/api/http.ts (错误信息)
```

这些多数是 v1.0.2 之前已有的设置/文件/安全页面文案，不属于本次新增的更新、Session、目录、证书、插件流程。若要求“全管理端无硬编码”，需要再做一轮完整 i18n 迁移，建议单独排期，避免在本轮更新/卸载改动中扩大风险。

## 6. 旧卸载工具

未发现独立的卸载 exe 或独立卸载脚本：

```text
未找到独立 uninstaller 工具文件
```

当前卸载由：

- Electron GUI：electron-builder NSIS uninstaller + `build/installer.nsh`
- Windows Server：Inno Setup uninstaller + `installer/inno/CloudBox.iss`

实现。两者都已加入“是否删除用户数据”的交互，静默更新跳过询问并保留数据。

## 7. 建议清理范围（待确认）

1. ~~删除 `installer/winsw/CloudBox.xml` 旧副本~~（已完成）。
2. ~~移除 `mime-types` / `@types/mime-types`~~（已完成）。
3. 统一 `security.sessionTtlHours` 命名或文档说明。
4. 另开 i18n 专项，覆盖 Settings/Network/Files/LowLevelSecurityPanel 的存量硬编码。
5. 清理 `admin/src/api/http.ts` 中已废弃的 notImplemented 包装（只保留真正桌面专属项）。

以上均未执行删除。
