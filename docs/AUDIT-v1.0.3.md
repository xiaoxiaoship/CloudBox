# CloudBox v1.0.3 静态与动态安全审计 / Security Audit

> 审计日期 / Date: 2026-11-28  
> 适用版本 / Applies to: 1.0.3

## 中文

### 范围

- 源码：`src/`、`admin/src/`、`web/src/`
- 测试与脚本：`tests/`、`scripts/`
- 安装器：`installer/`
- 变更重点：插件平台 API、公告、加密压缩/解压、用户 Web 英文补丁、管理端快速开始、打包版 7za 路径

### 静态检查

- `npm test`：206 passed / 0 failed
- `npm run typecheck`：通过
- `npm run typecheck:web`：通过
- `build:admin`、`build:web`、`build:headless`、`build:main`：通过

### 插件宿主能力

白名单能力：

```text
system.getStats
security.getBannedList   (只读)
user.getInfo / updateQuota / getMeta / setMeta
file.read / write / list / getUrl
ai.registerTool / injectPrompt
ui.register
事件订阅
```

明确不向插件暴露：

- 修改 WAF 策略
- 修改安全模式
- 封禁/解封
- 清除安全计数
- 读取其他插件私有存储
- 绕过 safePath

### 动态渗透

```text
PENTEST_OK
traversals: 5
csrf: 403
lockout: true
xss: true
hostingIsolated: true
```

### 打包版 7za 修复

便携版/安装版压缩任务曾出现：

```text
7za 退出码 -4058
```

根因是压缩服务使用了 asar 内不可执行的 `7zip-bin` 路径；1.0.3 包已改为优先使用：

```text
resources/bin/7za.exe
```

包内 `7za.exe` 已实测可正常创建 ZIP，退出码 0。

### 已知限制

- 安装包未配置代码签名，Windows SmartScreen 可能提示。
- 静态审计和动态渗透覆盖测试范围，不代表对所有部署环境的绝对安全保证。

## English

### Scope

- Source: `src/`, `admin/src/`, `web/src/`
- Tests/scripts: `tests/`, `scripts/`
- Installer: `installer/`
- Focus: plugin platform API, announcements, encrypted compression/extraction, Web English fallback, admin quick start, packaged 7za path

### Static checks

- `npm test`: 206 passed / 0 failed
- `npm run typecheck`: passed
- `npm run typecheck:web`: passed
- `build:admin`, `build:web`, `build:headless`, `build:main`: passed

### Plugin host capabilities

Whitelisted:

```text
system.getStats
security.getBannedList   (read-only)
user.getInfo / updateQuota / getMeta / setMeta
file.read / write / list / getUrl
ai.registerTool / injectPrompt
ui.register
event subscription
```

Plugins cannot modify WAF policy, security mode, bans or security counters, read other plugins' private storage, or bypass `safePath`.

### Dynamic penetration checks

```text
PENTEST_OK
traversals: 5
csrf: 403
lockout: true
xss: true
hostingIsolated: true
```

### Packaged 7za fix

Portable/installed builds previously failed compression with:

```text
7za exit code -4058
```

Compression now prefers the packaged executable:

```text
resources/bin/7za.exe
```

The packaged binary was verified to create a ZIP successfully with exit code 0.

### Known limitations

- Installers are unsigned; Windows SmartScreen may warn.
- Results cover the tested scope only and are not an absolute security guarantee for every deployment.
