# CloudBox v1.0.3

## 中文

### 修复

- 修复便携版/安装版压缩任务 `7za 退出码 -4058`：现在优先使用 `resources/bin/7za.exe`。
- 修复用户 Web 部分工具栏中英文混用。
- 修复管理员改密空输入时暴露 Zod 英文错误。

### 新增

- 公告系统：关键/警告/消息，用户 Web 铃铛通知与未读红点。
- 插件平台 API：系统状态、只读封禁列表、用户配额/元数据、文件读写、AI 工具、事件、iframe UI 插槽。
- 插件演示：`plugins/web-button-demo`。
- ZIP AES-256 加密压缩与加密解压密码输入。
- 用户 Web 英文兼容补丁。
- 管理端“快速开始”引导；插件 API 文档改为中文在上、英文在下。
- 头像修改限制、上传并发改进、按文件刷新。

### 安全

- 插件不能修改 WAF、安全模式、封禁/解封或安全计数。
- 文件插件能力全部经过 `safePath`。
- 动态渗透通过路径穿越、CSRF、登录锁定、XSS、托管隔离检查。
- 安装包未配置代码签名；Windows SmartScreen 可能提示。

### 下载

- GUI 安装版：`CloudBox-Setup-1.0.3-x64.exe`
- 便携版：`CloudBox-Portable-1.0.3-x64.exe`
- 服务器版：`CloudBox-Server-1.0.3-x64.exe`
- 文档包：`CloudBox-1.0.3-docs.zip`
- 校验：`SHA256SUMS-v1.0.3.txt`

## English

### Fixed

- Fixed packaged compression failing with `7za exit code -4058`; the packaged `resources/bin/7za.exe` is now preferred.
- Fixed mixed Chinese/English labels in parts of the user Web toolbar.
- Fixed English Zod errors when changing the administrator password with empty input.

### Added

- Announcements with critical/warning/message levels, bell notifications and unread dot.
- Plugin platform API: system stats, read-only ban list, user quota/metadata, file read/write, AI tools, events and iframe UI slots.
- Demo plugin: `plugins/web-button-demo`.
- ZIP AES-256 encrypted compression and encrypted extraction password prompt.
- English compatibility fallback for the user Web.
- Admin Quick Start; plugin API docs are now Chinese-first with English below.
- Avatar update restrictions, upload concurrency improvements and per-file refresh.

### Security

- Plugins cannot modify WAF policy, security mode, bans or security counters.
- Plugin file capabilities use `safePath`.
- Dynamic checks passed path traversal, CSRF, login lockout, XSS and hosting isolation.
- Installers are unsigned; Windows SmartScreen may warn.

### Downloads

- GUI installer: `CloudBox-Setup-1.0.3-x64.exe`
- Portable: `CloudBox-Portable-1.0.3-x64.exe`
- Server: `CloudBox-Server-1.0.3-x64.exe`
- Documentation: `CloudBox-1.0.3-docs.zip`
- Checksums: `SHA256SUMS-v1.0.3.txt`
