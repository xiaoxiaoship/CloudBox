# CloudBox GUI 配置指南 / GUI Configuration Guide

> 适用版本：1.0.1  
> Applies to: 1.0.1

## 本文目录 / Contents

```text
GUI 配置指南
├── 1. 启动、登录与界面
├── 2. 管理员账户
├── 3. 安全与运行
│   ├── 3.1 网络安全：简洁模式
│   ├── 3.2 网络安全：高级模式
│   ├── 3.3 选项卡与作用域
│   ├── 3.4 阈值、记录值与全局策略
│   ├── 3.5 当前封禁与计数
│   ├── 3.6 黑白名单
│   ├── 3.7 本地资源配布
│   └── 3.8 运行与审计日志
├── 4. 功能控制
│   ├── 4.1 用户网页自助注册
│   ├── 4.2 用户功能权限
│   ├── 4.3 安全查杀
│   ├── 4.4 AI 服务
│   ├── 4.5 内嵌静态托管
│   └── 4.6 邮件通知
├── 5. 系统与存储
│   ├── 5.1 启动与托盘
│   ├── 5.2 数据库备份
│   ├── 5.3 系统数据目录
│   ├── 5.4 网盘文件目录
│   └── 5.5 插件目录
├── 6. 网络设置
├── 7. 用户与文件
├── 8. 主题、配置导入导出与恢复默认
└── 9. English
```

---

# 中文

## 1. 启动、登录与界面

1. 运行安装版或便携版。
2. 首次启动创建唯一管理员账户。
3. 登录后左侧为功能导航：服务概览、用户管理、文件浏览、网络设置、插件、系统设置。
4. 右上角可以切换浅色/深色主题、查看在线状态、退出登录。
5. 关闭主窗口默认收起到系统托盘，不会直接退出服务。

主题会保存在本机，重启后保留。

## 2. 管理员账户

路径：系统设置 → 管理员账户。

### 管理员密码

- 当前密码
- 新密码
- 确认新密码

修改后所有管理员会话立即失效，需要重新登录。

### 管理员账户信息

- 修改管理员用户名
- 修改显示名称/头像（如当前版本提供）
- 管理员账号受保护，不能像普通用户一样删除

## 3. 安全与运行

该分组包含网络安全、本地资源配布、运行日志。

### 3.1 网络安全：简洁模式

适合不熟悉策略模型的用户。

可配置：

- 账号失败次数阈值
- 首次锁定分钟
- 最长锁定分钟
- IP 登录请求上限
- IP 统计窗口（分钟）
- IP 锁定时间（分钟）
- 每 IP 每小时注册上限
- 改名次数上限
- 改名统计窗口（小时）
- 改名锁定时间（小时）

简洁模式使用旧版硬编码逻辑：

- 账号失败锁定
- IP 请求限流
- 注册限流
- 改名限制

简洁模式不执行拖拽策略，也不执行 IPS。

### 3.2 网络安全：高级模式

高级模式使用 JSON 策略引擎，支持：

- IP 策略
- 账户策略
- 全局策略
- 功能限制
- 全局封禁
- 全局计数与自动停机
- IPS
- API 泛洪
- 黑白名单

默认模式为高级模式。

### 3.3 选项卡与作用域

三个投放区域：

```text
依据 IP | 依据账户 | 全局策略
```

- **依据 IP**：同一来源 IP 的请求/连接。
- **依据账户**：单个登录账户的行为/设备。
- **全局策略**：不区分来源与账户，按服务端整体统计。

选项卡来源分组：

- 通用
- 适用于 IP 与全局
- 适用于账户与全局
- 仅全局

拖拽规则：

- 从可选功能拖入区域即启用。
- 从区域拖出到“已保存但关闭”会保留配置但停用。
- 从“已保存但关闭”拖出框外会弹出删除确认。
- 仅全局卡片不能拖入 IP/账户区域。
- 同一个功能在同一个作用域只能出现一次。

### 3.4 阈值、记录值与全局策略

每个功能卡片通常包含：

- 统计窗口/阈值
- 封禁时间
- 触发一次记录值

时间规则：

```text
填 0     = 永久限制
留空     = 不限制时间，仅计数
可变封禁 = 从 1 开始递增
```

全局封禁：

- IP / 账户各自有“记录值累计阈值”和“全局封禁分钟”。
- 同一目标的功能限制记录值合计达到阈值后，清除功能封禁并升级为 `global`，阻断该目标全部操作。

全局策略：

- 全局计数阈值
- 自动恢复间隔（分钟，0 = 不自动恢复）
- 达到阈值后自动停止 Web 服务
- 离线不会清除 IP/账户封禁
- 手动开启 Web 后，本轮自动恢复计时停止

### 3.5 当前封禁与计数

入口：查看当前封禁。

顶部切换：

- 封禁记录
- 当前计数

封禁记录：

- 策略封禁 · IP
- 策略封禁 · 账户
- IP 封禁
- 账户封禁

计数：

- 选项卡触发计数
- IPS 计数
- API 泛洪计数
- 全局计数卡
- 支持逐项清除、全部清除
- 每 2 秒自动刷新

“一键解封并清除所有计数”会同时删除封禁、清除计数、写入重置时间并清零旧失败次数。

### 3.6 黑白名单

入口：IP / 账户黑白名单。

- IP 名单
- 账户名单
- 黑名单立即拒绝
- 白名单跳过全局封禁和自动策略限制
- 支持添加、删除
- 修改后保存网络安全设置生效

### 3.7 本地资源配布

- 最大同时解压任务数
- 最大同时查杀任务数
- 重度预览全局并发
- 单用户预览并发
- 日志保存上限（MB）
- 保存资源配布
- 清理缓存：清理临时上传文件和过期审计日志

重度预览适用于 PDF、Office、大视频；普通图片/文本不走重度队列。

### 3.8 运行与审计日志

- 运行日志：当前进程最近日志
- 审计日志：数据库中的操作记录
- 支持刷新、切换视图
- 日志按上限自动裁剪

## 4. 功能控制

### 4.1 用户网页自助注册

- 开关
- 开启后登录页显示注册入口
- 新用户默认普通用户、5 GB 配额
- 高级模式的注册频率由“注册量限制”选项卡控制
- 简洁模式保留每 IP 每小时注册上限

### 4.2 用户功能权限

- 图片在线预览
- 视频在线播放
- PDF 在线预览
- Office 在线预览
- 在线解压
- 安全查杀

关闭后 Web 入口隐藏，后端接口返回 403。

### 4.3 安全查杀

- 总开关
- 模式：本地 ClamAV / VirusTotal API
- VirusTotal API Key
- ClamAV 目录
- infected 文件禁止下载、分享、解压

### 4.4 AI 服务

- 总开关
- 管理员共享配置 / 用户自填配置
- Base URL、模型、API Key
- 普通用户每日上限

### 4.5 内嵌静态托管

- 总开关
- 公网基础地址
- 站点挂载在 `/host/`
- 不额外监听端口
- 端口复用依赖 frp HTTP/HTTPS 隧道
- 支持公开/私有站点
- hosted 页面与主站 API 隔离

### 4.6 邮件通知

- 邮件总开关
- SMTP Host / Port / TLS
- SMTP 用户
- 授权码/密码
- 发件人、告警接收邮箱
- 事件：
  - 新用户注册
  - 安全告警
  - 安全限制触发
  - 本地资源告警
  - 系统错误
- 发送测试邮件

密码使用 AES-256-GCM 加密；无法解密时需重新填写授权码。

## 5. 系统与存储

### 5.1 启动与托盘

- 开机自动启动
- 自启动后收起到托盘
- 手动启动仍显示主窗口

### 5.2 数据库备份

- SQLite 在线备份
- 包含用户、配额、设置、审计日志
- 不包含网盘文件本身
- 备份数据库时同时备份 `ai-secret.key`

### 5.3 系统数据目录

包含数据库、证书、CA、frp 配置、加密密钥。

### 5.4 网盘文件目录

所有用户上传文件。

### 5.5 插件目录

已安装插件及其私有 storage。

修改目录时可迁移数据；迁移完成并勾选删除旧文件后不可撤销。

## 6. 网络设置

- 服务启停
- 监听端口
- HTTP / HTTPS
- 证书导入
- 私有 CA 创建/安装/导出
- mTLS
- frp 配置
- 信任反向代理真实 IP
- 定时启停
- 开机自动在线

frp 支持 HTTP/HTTPS/TCP；HTTP/HTTPS 可保留真实客户端 IP；TCP 可启用 PROXY Protocol v2。

## 7. 用户与文件

### 用户管理

- 创建用户
- 分配配额
- 重置密码
- 禁用/启用
- 删除用户
- 查看连接客户端
- 查看登录 IP 历史
- 排序、搜索 IP

### 文件浏览

- 上传、下载、移动、复制、重命名、删除
- 文件夹
- 多选操作
- 解压、查杀
- 分享
- 预览

## 8. 主题、配置导入导出与恢复默认

- 顶部“浅色/深色”切换主题
- 系统设置顶部：
  - 一键恢复默认设置
  - 导出配置
  - 导入配置
- 导入/导出可能受版本差异影响；导入后建议检查关键设置
- 恢复默认会清除封禁、旧锁定和计数，但不会删除用户、文件或数据库

---

# English

## 1. Launch, sign-in and UI

1. Run the installer or portable build.
2. Create the sole administrator account on first launch.
3. Navigation: Dashboard, Users, Files, Network, Plugins, Settings.
4. Top-right: light/dark theme, online status, sign out.
5. Closing the window hides it to the tray by default.

Theme is stored locally and survives restarts.

## 2. Administrator account

Path: Settings → Administrator account.

- Current password, new password, confirmation.
- Changing the password revokes all administrator sessions.
- Administrator username/display settings.
- The administrator is protected from regular-user deletion.

## 3. Security & operations

### 3.1 Simple mode

Fields:

- Account failure threshold
- First/max lock minutes
- IP login request limit/window/lock
- Registrations per IP per hour
- Rename count/window/lock

Simple mode uses legacy hard-coded account lock, IP rate limiting, registration rate limiting and rename limits. It does not execute drag-and-drop policies or IPS.

### 3.2 Advanced mode

Advanced mode uses the JSON policy engine:

- IP / account / global policies
- Feature restrictions and global bans
- Counts and automatic service stop
- IPS
- API flood
- Allow/deny lists

Advanced is the default.

### 3.3 Scopes

```text
By IP | By account | Global policy
```

- By IP: one source IP.
- By account: one signed-in account.
- Global: server-wide, independent of source/account.

Source groups:

- General
- For IP and global
- For account and global
- Global only

Drag rules:

- Dragging from available features enables a card.
- Dragging to “Saved but disabled” keeps configuration but disables it.
- Dragging a saved card outside asks for deletion confirmation.
- Global-only cards cannot be dropped into IP/account zones.
- One feature can exist only once per scope.

### 3.4 Thresholds, record values and global policy

Time fields:

```text
0     = permanent
blank = no time limit, count only
variable ban = starts at 1
```

Global bans:

- IP/account record-value threshold and global ban minutes.
- Reaching the threshold removes feature bans and creates a `global` ban blocking all operations for that target.

Global policy:

- Global count threshold
- Auto-recovery interval (0 = disabled)
- Stops the Web service at the threshold
- Does not clear IP/account bans
- Manual start stops the current recovery timer

### 3.5 Bans and counts

Entry: View current bans.

Tabs: Bans / Current counts.

- Strategy bans by IP/account
- IP/account global bans
- Counts for feature triggers, IPS, API flood and global counters
- Clear individual or all counts
- Auto-refresh every 2 seconds

“Unban all and clear all counts” removes bans, clears counts, records reset times and resets legacy failure counters.

### 3.6 Allow/deny lists

- IP and account tabs
- Blacklist rejects immediately
- Whitelist bypasses global bans and automatic policy restrictions
- Add/delete, then save security settings

### 3.7 Local resource allocation

- Max extraction tasks
- Max scan tasks
- Heavy-preview global concurrency
- Per-user preview concurrency
- Log size limit
- Save / clear cache

Heavy preview covers PDF, Office and large video. Images and text do not use the heavy queue.

### 3.8 Logs

- Runtime logs
- Audit logs
- Refresh and switch views
- Automatic trimming by size limit

## 4. Feature controls

### 4.1 Public registration

- Toggle registration
- New users are regular users with 5 GB quota
- Advanced mode uses the registration policy card
- Simple mode keeps the per-IP hourly registration limit

### 4.2 User permissions

- Image/video/PDF/Office preview
- Extraction
- Scanning

Disabled features hide the Web entry and return 403 from APIs.

### 4.3 Scanning

- Master switch
- ClamAV / VirusTotal mode
- API key / ClamAV path
- Infected files cannot be downloaded, shared or extracted

### 4.4 AI

- Master switch
- Admin-shared or user-provided configuration
- Base URL, model, API key, daily limit

### 4.5 Static hosting

- Master switch
- Public base URL
- Served under `/host/`
- No extra listening port; port reuse via frp HTTP/HTTPS
- Public/private sites
- Hosted pages isolated from the main API

### 4.6 Email notifications

- SMTP host/port/TLS/user/password
- From/to
- Events: registration, security alert, security limit, resource alert, system error
- Test email

Passwords use AES-256-GCM; re-enter the authorization code if decryption fails.

## 5. System & storage

- Startup and tray
- SQLite online backup (database, users, settings, audit; not user files)
- Data directory (database, certificates, CA, frp config, secret key)
- Drive directory
- Plugin directory

Directory migration can copy data; deleting old files after migration is irreversible.

## 6. Network

- Service start/stop
- Port
- HTTP/HTTPS
- Certificate import
- Private CA create/install/export
- mTLS
- frp
- Trust proxy real IP
- Scheduled on/off
- Auto-online at startup

frp supports HTTP/HTTPS/TCP. HTTP/HTTPS preserves the client IP; TCP supports PROXY Protocol v2.

## 7. Users and files

- Create users, quotas, reset password, disable/enable, delete
- Connected clients and login IP history
- Upload/download/move/copy/rename/delete
- Folder operations, multi-select, extract, scan, share, preview

## 8. Theme, import/export and reset

- Light/dark toggle in the header
- Restore defaults, export config, import config
- Cross-version compatibility is not guaranteed
- Restore defaults clears bans/locks/counts but not users, files or the database
