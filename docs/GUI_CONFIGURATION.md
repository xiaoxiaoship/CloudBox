# CloudBox 配置指南 / Configuration Guide

> 适用版本：1.0.3  
> Applies to: 1.0.3

本指南同时说明 **Electron GUI** 与 **Web 管理版**。两者共用业务设置，但入口、认证和部分桌面能力不同。

This guide covers both the **Electron GUI** and the **Web Admin**. Business settings are shared; entry points, authentication and some desktop-only capabilities differ.

## 目录 / Contents

```text
1. 先读：GUI 与 Web 管理版
2. 首次启动与登录
3. 管理员账户
4. 安全与运行
   4.1 简洁模式
   4.2 高级模式：作用域与拖拽
   4.3 策略字段与时间填写规则
   4.4 功能说明
   4.5 全局封禁、计数与名单
   4.6 底层安全控制
   4.7 本地资源与日志
5. 功能控制
6. 系统与存储
7. 网络设置
8. 用户、文件与插件
9. 主题、导入导出与恢复
10. 常见填空问题
```

---

## 1. 先读：GUI 与 Web 管理版

| 能力 | Electron GUI | Web 管理版 |
|---|---|---|
| 管理入口 | 桌面窗口 | 浏览器 `:1250` |
| 管理员登录 | 首次向导 + GUI 登录 | `/setup?token=...` 初始化，再登录 |
| 管理员 Session | Electron 主进程内存 | 独立 `admin_sessions` 表 |
| API 通道 | Electron IPC | HTTP `/api/admin/*` |
| 数据目录 | `%APPDATA%\cloudbox` | `%PROGRAMDATA%\CloudBox` |
| 用户 Web 开关 | GUI 在线模式 | Web 管理端在线模式 |
| 管理 Web 自身 | 不启动 | 固定 1250，始终启动 |
| 桌面文件选择器 | 支持 | 不支持 |
| 目录迁移 | 支持原生选择器 | 支持手动输入绝对路径 |
| 插件导入 | 文件夹/ZIP | 浏览器上传 ZIP |
| 证书/私钥导入 | 原生文件选择器 | 浏览器上传 |
| CA 客户端证书导出 | 保存到本机 | 下载到浏览器设备 |
| 数据库备份 | 保存到本机 | 下载到浏览器设备 |
| 管理 Web 内网限制 | 不适用 | 默认开启，可关闭 |

**安全提醒：**Web 管理端的 1250 端口不要通过 frp 映射。frp 只应映射用户 Web 端口。

## 2. 首次启动与登录

### GUI 版

1. 启动安装版或便携版。
2. 首次运行进入创建管理员向导。
3. 输入管理员用户名、密码、确认密码。
4. 密码至少 8 位，且同时包含字母和数字。
5. 创建后自动登录到「服务概览」。

### Web 管理版

1. 安装并启动 `CloudBox` Windows 服务。
2. 查看服务日志或控制台，找到：

   ```text
   http://<内网IP>:1250/setup?token=...
   ```

3. 用同一内网的浏览器打开该 URL。
4. 输入用户名、密码、确认密码完成初始化。
5. token 默认 24 小时有效，建号成功后立即失效。

token 文件：

```text
%PROGRAMDATA%\CloudBox\config\admin-init-token.json
```

如果 token 丢失或过期：

1. 停止 CloudBox 服务。
2. 删除 `admin-init-token.json`。
3. 重新启动服务。
4. 查看日志中的新 URL。

> 初始化 token 只保存 SHA-256 哈希，不能从文件反推出原始 token。

## 3. 管理员账户

路径：

```text
系统设置 → 管理员账户
```

### 管理员用户名

- 1–64 个字符。
- 不允许空格和 `/ \ : * ? " < > |` 等字符。
- Web 管理版当前没有实现管理员用户名修改 HTTP 接口，修改请在 GUI 完成。

### 修改密码

- 当前密码
- 新密码
- 确认新密码

修改后旧管理员会话失效，需要重新登录。

> Web 管理版通过 `POST /api/admin/auth/password` 修改密码；修改后所有管理会话立即失效，需要重新登录。

### 管理员 GUI 空闲锁定

- 默认为开启。
- 默认 30 分钟。
- 取值范围 1–1440 分钟。
- 无操作后管理员前端自动退出，需要重新登录。
- 该锁定是前端计时器；服务端 Session 仍按 Session TTL 失效。

### 管理 Session

- 管理 Session 固定 **4 小时**，独立于用户 Web 的 `security.sessionTtlHours`。
- Web 管理端可查看当前管理会话列表（IP、UA、最后活动、到期时间）。
- `全部注销` 会撤销当前管理员的所有管理会话并清空 Cookie。
- 登录接口使用 double-submit CSRF；登录前需先访问 `/api/admin/auth/status` 获取 `admin_csrf`。

### 管理 Web 仅限内网访问

仅 Web 管理版显示。

- 默认开启。
- 判断依据：直接读取 socket 地址，不信任 `X-Forwarded-For`。
- 允许 loopback、10/8、172.16/12、192.168/16、169.254/16、IPv6 ULA/链路本地。
- 关闭时必须二次确认。
- 关闭后任何能访问 1250 的客户端都能看到管理员登录页。
- 不建议关闭；如必须远程管理，使用 VPN、SSH 隧道或 HTTPS 反向代理 + 防火墙白名单。

## 4. 安全与运行

路径：

```text
系统设置 → 安全与运行
```

### 4.1 简洁模式

适合不熟悉策略卡的用户。

| 字段 | 默认值 | 单位 | 作用 |
|---|---:|---|---|
| 启用旧版安全限制 | 开 | — | 总开关 |
| 账号失败次数阈值 | 5 | 次 | 连续失败达到后锁定账号 |
| 首次锁定分钟 | 1 | 分钟 | 第一次锁定时长 |
| 最长锁定分钟 | 60 | 分钟 | 递增锁定上限 |
| IP 登录请求上限 | 30 | 次 / 窗口 | 同一 IP 的登录请求限制 |
| IP 统计窗口 | 15 | 分钟 | 统计窗口 |
| IP 锁定时间 | 15 | 分钟 | 超过上限后的锁定时间 |
| 每 IP 每小时注册上限 | 2 | 次 / 小时 | 注册限流 |
| 改名限制 | 开 | — | 是否限制改名 |
| 改名次数上限 | 1 | 次 | 统计窗口内允许次数 |
| 改名统计窗口 | 24 | 小时 | 统计周期 |
| 改名锁定时长 | 24 | 小时 | 超限后的锁定时间 |

简洁模式只执行旧版账号锁定、IP 登录限流、注册限制和改名限制，不执行高级策略卡，也不执行 IPS。

### 4.2 高级模式：作用域与拖拽

高级模式使用 JSON 策略引擎。

三个投放区：

```text
依据 IP | 依据账户 | 全局策略
```

- **依据 IP**：同一来源 IP 的登录失败、连接、请求。
- **依据账户**：单个登录账户的行为和设备/IP 数量。
- **全局策略**：不区分来源和账户，按服务端整体统计。

功能卡来源分组：

- 通用
- 适用于 IP 与全局
- 适用于账户与全局
- 仅全局

拖拽规则：

- 从「可选功能」拖入某个作用域即启用。
- 从作用域拖到「已保存但关闭」：保留参数但停用。
- 从「已保存但关闭」拖回原作用域：恢复启用。
- 从「已保存但关闭」拖到框外：弹确认后删除。
- 仅全局卡片不能拖入 IP/账户区域。
- 同一功能在同一作用域只能出现一次。

### 4.3 策略字段与时间填写规则

常见字段：

| 字段 | 含义 |
|---|---|
| 统计窗口 | 在多长时间内累计 |
| 阈值 | 达到多少次触发 |
| 记录值 | 触发后向上层封禁计数增加多少 |
| 固定封禁 | 每次固定封禁多少分钟 |
| 首次封禁 | 可变封禁的起始分钟 |
| 最长封禁 | 可变封禁上限 |
| 统计方式 | 按时间窗口 / 距上次解封以来累计 |

时间填写规则：

```text
填 0       = 永久封禁
留空       = 不限制时间，仅计数（固定封禁字段）
填正整数   = 按该分钟/小时数封禁
可变封禁   = 从 1 开始，不能留空或填 0
```

可变封禁计算：

```text
封禁时长 = 首次封禁 × 2^(超过阈值次数)
封禁时长不超过最长封禁
```

例如：

```text
首次 1 分钟，最长 60 分钟：
第 1 次超限 1 分钟
第 2 次 2 分钟
第 3 次 4 分钟
...
封顶 60 分钟
```

固定封禁留空时，策略只会计数并向上层增加封禁数，不会直接封禁当前功能。

### 4.4 功能说明

| 功能 | 可用作用域 | 作用 |
|---|---|---|
| 登录失败限制 | IP / 账户 | 统计登录失败，达到阈值后限制登录 |
| 注册量限制 | IP / 全局 | 统计时间窗口内成功注册数 |
| Cap 人机验证 | IP / 全局 | 达到阈值后要求完成 PoW |
| 改名限制 | 账户 / 全局 | 限制统计周期内改名次数 |
| 同时在线人数 | 账户 / 全局 | 限制同时连接的客户端数 |
| 历史 IP 计数限制 | 账户 / 全局 | 限制周期内出现过的不同登录 IP 数 |
| 同时在线 IP 量限制 | 账户 / 全局 | 限制当前同时在线的不同 IP 数 |
| IPS 攻击特征拦截 | IP / 全局 | 命中 XSS/SQLi/路径穿越/命令注入/扫描器特征，仅拦截当前请求并计数 |
| API 泛洪拦截 | IP / 账户 / 全局 | 按窗口统计 `/api` 请求；默认排除健康检查、任务轮询、当前用户、Range 请求 |
| 计入 IP 全局封禁数 | 仅全局 | IP 级触发时向上层全局计数增加记录值 |
| 计入账户全局封禁数 | 仅全局 | 账户级触发时向上层全局计数增加记录值 |

### 4.5 全局封禁、计数与名单

#### IP / 账户全局封禁

- IP 阈值默认 10，封禁 30 分钟。
- 账户阈值默认 10，封禁 30 分钟。
- 同一目标的功能限制记录值合计达到阈值后：
  - 清除该目标的功能封禁；
  - 升级为 IP/账户全局封禁；
  - 阻止该目标后续操作。

#### 全局策略

- 全局计数阈值默认 15。
- 自动恢复间隔默认 5 分钟。
- 恢复间隔填 0 = 不自动恢复。
- 达到全局阈值后自动停止用户 Web。
- 离线不会清除 IP/账户封禁。
- 自动恢复期间手动开启用户 Web，则本轮自动恢复计时停止，避免冲突。

#### 查看当前封禁

顶部切换：

- 封禁记录
- 当前计数

计数包含：

- 选项卡触发计数
- IPS 计数
- API 泛洪计数
- 全局计数

支持逐项清除、全部清除，计数窗口每 2 秒刷新。

「一键解封并清除所有计数」会删除封禁、清除计数、写入重置时间并清零旧失败次数。

#### 黑白名单

- IP 黑名单立即拒绝。
- IP 白名单跳过全局封禁和自动策略限制。
- 账户黑名单/白名单同理。
- 修改后保存网络安全设置生效。

### 4.6 底层安全控制

路径：

```text
高级模式 → 底部「底层安全控制」
```

默认全部启用。点击后必须经过红色警告二次确认，才可修改。

注意：

- 这些限制先于 WAF 策略执行。
- 数值过小会让底层先于策略拦截正常请求。
- 网络/插件超时类参数在下次服务或插件启动时完全生效。

#### 基础防护

| 字段 | 默认值 | 单位 |
|---|---:|---|
| 全局 API 限流 | 600 | 次/分钟 |
| 上传限流 | 120 | 次/分钟 |
| 分享创建限流 | 10 | 次/分钟 |
| 分享下载限流 | 60 | 次/分钟 |
| 解压限流 | 10 | 次/分钟 |
| 查杀限流 | 10 | 次/分钟 |
| IP 注册限制 | 2 | 次/小时 |

#### IO 与资源

| 字段 | 默认值 | 单位 |
|---|---:|---|
| 单文件上传上限 | 2 GiB | 字节 |
| 文件列表上限 | 5000 | 项 |
| 批量操作上限 | 100 | 个 |
| 文本预览上限 | 512 KiB | 字节 |
| 解压并发 | 10 | 个 |
| 查杀并发 | 10 | 个 |
| 本地 ClamAV 大小上限 | 100 MiB | 字节 |
| 本地 ClamAV 超时 | 300 | 秒 |
| 前端并发上传数 | 10 | 个 |
| 上传排水上限 | 16 MiB | 字节 |
| 分享有效期上限 | 7200 | 秒 |

#### 生命周期与网络

| 字段 | 默认值 | 单位 |
|---|---:|---|
| 用户 Session 有效期 | 168 | 小时 |
| 在线判定窗口 | 300 | 秒 |
| PROXY 等待超时 | 3000 | 毫秒 |
| frp 健康检查超时 | 3 | 秒 |
| frp 健康检查间隔 | 10 | 秒 |
| TLS 最低版本 | TLS 1.2 | — |
| HTTP headers 超时 | 60000 | 毫秒 |
| HTTP request 超时 | 300000 | 毫秒 |

#### 插件与 IPC

| 字段 | 默认值 | 单位 |
|---|---:|---|
| 插件启动超时 | 10000 | 毫秒 |
| 插件请求超时 | 15000 | 毫秒 |

#### 死守红线（只展示）

- safePath 路径安全
- CSRF
- 密码策略
- 防压缩炸弹基础阈值（10000 文件 / 50GB / 5 分钟）
- JSON 1MB 上限
- Cookie Secure/HttpOnly

#### WAF 冲突提示

如果 WAF 策略阈值高于底层限制，例如：

```text
API 泛洪阈值 800 次/分钟
底层 API 限流 600 次/分钟
```

底层会先返回 429，策略不会先触发。面板会显示冲突警告。

### 4.7 本地资源与日志

- 最大同时解压任务数：默认 10。
- 最大同时查杀任务数：默认 10。
- 重度预览全局并发：默认 10（PDF/Office/大视频）。
- 单用户预览并发：默认 10。
- 日志保存上限：默认 100 MB。
- 清理缓存：删除上传临时文件、过期审计日志。
- 运行日志：当前进程最近日志。
- 审计日志：数据库中的操作记录。

## 5. 功能控制

### 5.1 用户网页自助注册

- 总开关。
- 开启后用户 Web 登录页显示注册入口。
- 新用户默认普通用户、5GB 配额。
- 高级模式注册频率由「注册量限制」控制。
- 简洁模式使用每 IP 每小时注册上限。

### 5.2 用户功能权限

- 图片在线预览
- 视频在线播放
- PDF 在线预览
- Office 在线预览
- 在线解压
- 安全查杀

关闭后前端隐藏入口，后端接口返回 403。

### 5.3 安全查杀

- 总开关
- 模式：本地 ClamAV / VirusTotal API
- VirusTotal API Key
- ClamAV 目录
- 本地模式超过大小上限返回 `skipped`
- `infected` 文件禁止下载、分享、解压

### 5.4 AI 服务

- 总开关
- 管理员共享配置 / 用户自填配置
- Base URL、模型、API Key
- 普通用户每日上限

### 5.5 内嵌静态托管

- 总开关
- 公网基础地址
- 站点挂载在 `/host/`
- 不额外监听端口
- 端口复用依赖 frp HTTP/HTTPS 隧道
- 支持公开/私有站点
- hosted 页面与主站 API 隔离

### 5.6 邮件通知

- 邮件总开关
- SMTP Host / Port / TLS
- SMTP 用户
- 授权码/密码
- 发件人、告警接收邮箱
- 事件：新用户注册、安全告警、安全限制触发、本地资源告警、系统错误
- 发送测试邮件

密码使用 AES-256-GCM 加密；无法解密时需重新填写授权码。

## 6. 系统与存储

### 6.1 启动与托盘（GUI）

- 开机自动启动
- 自启动后收起到托盘
- 手动启动仍显示主窗口

Web 管理版没有托盘/自启动设置，由 Windows 服务负责。

### 6.2 数据库备份

- SQLite 在线备份
- 包含用户、配额、设置、审计日志
- 不包含网盘文件本身
- 备份数据库时同时备份 `ai-secret.key`
- GUI 保存到本机
- Web 下载到浏览器所在设备

### 6.3 系统数据目录

包含数据库、证书、CA、frp 配置、加密密钥。

- GUI 可更改并迁移。
- Web 管理版可输入服务器绝对路径修改目录；目标目录必须为空。
- 修改数据目录时会复制 `cloudbox.db`、`config` 和 `ai-secret.key`，然后服务自动重启；为避免路径指针丢失，数据库旧目录不会自动删除。
- 网盘/插件目录迁移完成并勾选删除旧文件后会清理旧目录。

### 6.4 网盘文件目录

所有用户上传文件。GUI 和 Web 均可迁移；Web 使用绝对路径输入，目标目录必须为空。

### 6.5 插件目录

已安装插件及其私有 storage。GUI 和 Web 均可迁移；Web 使用绝对路径输入。

修改目录时可迁移数据；迁移完成并勾选删除旧文件后不可撤销。Web 迁移数据目录时保留旧目录，因为它保存 headless 路径指针。

## 7. 网络设置

### 7.1 用户 Web 在线模式

- GUI：在线模式开关控制用户 Web。
- Web：管理 Web 始终运行，用户 Web 由在线模式开关控制。
- 默认新装为离线。

### 7.2 端口

- 用户端口范围 1024–65535。
- 不能为 1250。
- 修改后在线状态会自动重启用户 Web。
- 失败时回滚端口配置。

### 7.3 HTTP / HTTPS

- HTTP 仅建议在可信局域网使用。
- HTTPS 需要证书与私钥。
- GUI 可导入 `.crt/.pem/.cer` 和 `.key/.pem`。
- Web 管理版通过浏览器上传 `.crt/.pem/.cer` 和 `.key/.pem`。
- CA 客户端证书由浏览器下载，PKCS#12 密码为 `changeit`。
- mTLS 开启后浏览器必须导入客户端证书。

### 7.4 frp

字段：

| 字段 | 说明 |
|---|---|
| frps 地址 | 服务器域名或 IP |
| frps 端口 | 默认 7000 |
| token | frps 认证 token，可留空 |
| 用户名 | frp user，可留空 |
| 代理名 | frpc 代理名称 |
| 隧道类型 | TCP / HTTP / HTTPS |
| 远程端口 | TCP 模式使用 |
| 自定义域名 | HTTP/HTTPS 模式使用 |
| PROXY Protocol v2 | TCP/HTTPS 可启用，保留真实 IP |
| tcpMux | 健康检查与业务共用 TCP |

健康检查固定参数：

```text
timeoutSeconds = 3
maxFailed = 3
intervalSeconds = 10
```

可通过底层安全控制修改超时/间隔，但 maxFailed 固定为 3。

### 7.5 私有 CA 与 mTLS

- 创建私有 CA
- 安装到系统信任库
- 签发服务器证书
- 导出客户端证书（GUI）
- 卸载只移除系统信任，不删除 CA 文件
- 客户端 PKCS#12 默认密码 `changeit`

## 8. 用户、文件与插件

### 用户管理

- 创建、删除用户
- 设置配额（0 或留空表示无限）
- 重置密码（下次登录强制修改）
- 禁用/启用
- 解锁
- 清除改名限制
- 查看历史 IP
- 管理员不能像普通用户一样删除自己

### 文件浏览（管理员只读）

- 浏览所有用户目录
- 下载文件
- 路径经 safePath 校验

### 插件

- 导入插件（GUI 支持文件夹/ZIP；Web 当前仅管理已有插件）
- 启用/停止
- 允许 Web 接管
- 卸载
- 打开插件管理页
- 插件运行在独立子进程

## 8.1 自动更新

- 检查更新后，管理端会下载与当前形态匹配的安装包（GUI Setup / Server）。
- 下载显示百分比与字节进度，完成后校验大小和 GitHub digest。
- 校验通过后自动运行安装包静默覆盖安装，并重启 GUI 或 Windows 服务。
- 便携版建议手动替换文件；开发版仅用于验证。
- 失败会落为 error 状态，不会执行安装。

## 8.2 卸载与数据保留

- 系统“应用和功能”或安装目录卸载会询问是否删除用户数据。
- 选择“否”保留 `%APPDATA%\cloudbox` 与 `%PROGRAMDATA%\CloudBox`，重装可恢复。
- 选择“是”删除账号、文件与配置；不可撤销。
- 静默更新不会弹出该询问，并始终保留数据。

## 9. 主题、导入导出与恢复

- 浅色 / 深色主题
- 语言切换（中文 / English）
- 导入/导出配置
- 恢复默认设置
- 恢复默认会清除安全策略和运行时封禁，请谨慎

## 10. 常见填空问题

### 时间字段留空是什么意思？

- 固定封禁时间留空：**只计数，不封禁**。
- 填 `0`：**永久封禁**。
- 可变封禁：**不能留空或填 0**，从 1 开始。

### 配额留空是什么意思？

用户配额留空或填 0 表示**无限配额**。

### token 留空会怎样？

frp token 留空表示不启用 token 认证，仅建议在可信 frps 使用。

### 端口留空可以吗？

不可以。端口必须是 1024–65535 的整数，且不能是 1250。

### 管理员 Web 可以映射 frp 吗？

不建议。管理 Web 没有内置 HTTPS，且 frp 本机连接会绕过 `intranetOnly`。只映射用户 Web。

---

---

# English

## CloudBox Configuration Guide

> Applies to: 1.0.3  

This guide covers both the **Electron GUI** and the **Web Admin**. They share business settings, but entry points, authentication and some desktop capabilities differ.

### Contents

```text
1. Read First: GUI vs Web Admin
2. First Start and Login
3. Administrator Account
4. Security and Runtime
   4.1 Simple Mode
   4.2 Advanced Mode: Scopes and Drag-and-Drop
   4.3 Policy Fields and Time Entry Rules
   4.4 Feature Descriptions
   4.5 Global Bans, Counters and Lists
   4.6 Low-level Security Controls
   4.7 Local Resources and Logs
5. Feature Controls
6. System and Storage
7. Network Settings
8. Users, Files and Plugins
9. Theme, Import/Export and Restore
10. Common Blank-Field Questions
```

---

### 1. Read First: GUI vs Web Admin

| Capability | Electron GUI | Web Admin |
|---|---|---|
| Admin entry point | Desktop window | Browser `:1250` |
| Admin login | First-run wizard + GUI login | `/setup?token=...` initialization, then login |
| Admin session | Electron main-process memory | Separate `admin_sessions` table |
| API channel | Electron IPC | HTTP `/api/admin/*` |
| Data directory | `%APPDATA%\cloudbox` | `%PROGRAMDATA%\CloudBox` |
| User Web switch | GUI online mode | Web Admin online mode |
| Admin Web itself | Not started | Fixed at 1250, always running |
| Desktop file picker | Supported | Not supported |
| Directory migration | Supports native picker | Supports manual absolute path input |
| Plugin import | Folder/ZIP | Browser ZIP upload |
| Certificate/private key import | Native file picker | Browser upload |
| CA client certificate export | Save to local machine | Download to browser device |
| Database backup | Save to local machine | Download to browser device |
| Admin Web intranet restriction | Not applicable | On by default, can be disabled |

**Security note:** Do not map port 1250 of the Web Admin through frp. frp should only map the user Web port.

### 2. First Start and Login

#### GUI

1. Start the installed or portable version.
2. On first run, the create-administrator wizard opens.
3. Enter the administrator username, password and password confirmation.
4. The password must be at least 8 characters and contain both letters and digits.
5. After creation you are logged in automatically to "Service Overview".

#### Web Admin

1. Install and start the `CloudBox` Windows service.
2. Check the service log or console to find:

   ```text
   http://<intranet IP>:1250/setup?token=...
   ```

3. Open that URL in a browser on the same intranet.
4. Enter the username, password and password confirmation to complete initialization.
5. The token is valid for 24 hours by default and becomes invalid immediately after the account is created.

Token file:

```text
%PROGRAMDATA%\CloudBox\config\admin-init-token.json
```

If the token is lost or has expired:

1. Stop the CloudBox service.
2. Delete `admin-init-token.json`.
3. Restart the service.
4. Check the log for the new URL.

> The initialization token is stored only as a SHA-256 hash; the original token cannot be derived from the file.

### 3. Administrator Account

Path:

```text
System Settings → Administrator Account
```

#### Administrator username

- 1–64 characters.
- Spaces and characters such as `/ \ : * ? " < > |` are not allowed.
- The Web Admin currently has no HTTP interface for changing the administrator username; make the change in the GUI.

#### Change password

- Current password
- New password
- Confirm new password

After the change, the old administrator sessions become invalid and you must log in again.

> The Web Admin changes the password through `POST /api/admin/auth/password`; after the change, all admin sessions become invalid immediately and you must log in again.

#### Administrator GUI idle lock

- On by default.
- 30 minutes by default.
- Value range 1–1440 minutes.
- After inactivity, the administrator front end logs out automatically and you must log in again.
- This lock is a front-end timer; the server-side Session still expires according to the Session TTL.

#### Admin session

- Admin sessions are fixed at **4 hours**, independent of the user Web `security.sessionTtlHours`.
- The Web Admin can display the list of current admin sessions (IP, UA, last activity, expiry time).
- `Log out all` revokes all admin sessions of the current administrator and clears the Cookie.
- The login interface uses double-submit CSRF; before logging in you must first call `/api/admin/auth/status` to obtain `admin_csrf`.

#### Admin Web intranet-only access

Shown only in the Web Admin.

- On by default.
- Basis: the socket address is read directly and `X-Forwarded-For` is not trusted.
- Allows loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, IPv6 ULA/link-local.
- Disabling requires a second confirmation.
- After disabling, any client that can reach 1250 can see the administrator login page.
- Disabling is not recommended; if remote administration is required, use a VPN, an SSH tunnel or an HTTPS reverse proxy + firewall allowlist.

### 4. Security and Runtime

Path:

```text
System Settings → Security and Runtime
```

#### 4.1 Simple Mode

Suitable for users who are not familiar with policy cards.

| Field | Default | Unit | Effect |
|---|---:|---|---|
| Enable legacy security limits | On | — | Master switch |
| Account failure threshold | 5 | times | Lock the account after this many consecutive failures |
| First lock minutes | 1 | minutes | Duration of the first lock |
| Maximum lock minutes | 60 | minutes | Upper limit of the increasing lock |
| IP login request limit | 30 | times / window | Login request limit for the same IP |
| IP statistics window | 15 | minutes | Statistics window |
| IP lock time | 15 | minutes | Lock time after the limit is exceeded |
| Registrations per IP per hour | 2 | times / hour | Registration rate limit |
| Rename limit | On | — | Whether renaming is restricted |
| Rename count limit | 1 | times | Allowed count within the statistics window |
| Rename statistics window | 24 | hours | Statistics period |
| Rename lock duration | 24 | hours | Lock time after the limit is exceeded |

Simple mode only enforces legacy account locking, IP login rate limiting, registration restriction and rename restriction; it does not run advanced policy cards or IPS.

#### 4.2 Advanced Mode: Scopes and Drag-and-Drop

Advanced mode uses the JSON policy engine.

Three drop zones:

```text
By IP | By account | Global policy
```

- **By IP**: login failures, connections and requests from the same source IP.
- **By account**: the behavior of a single login account and its number of devices/IPs.
- **Global policy**: statistics for the server as a whole, regardless of source and account.

Feature card source groups:

- General
- Applies to IP and global
- Applies to account and global
- Global only

Drag rules:

- Dragging from "Available Features" into a scope enables it.
- Dragging from a scope to "Saved but disabled": keeps the parameters but disables it.
- Dragging from "Saved but disabled" back to the original scope: enables it again.
- Dragging from "Saved but disabled" outside the area: deletes it after a confirmation prompt.
- Global-only cards cannot be dragged into the IP/account areas.
- The same feature can appear only once in the same scope.

#### 4.3 Policy Fields and Time Entry Rules

Common fields:

| Field | Meaning |
|---|---|
| Statistics window | Over how long counts accumulate |
| Threshold | How many times before it triggers |
| Record value | How much the upper-level ban counter increases after a trigger |
| Fixed ban | How many minutes each fixed ban lasts |
| First ban | Starting minutes of a variable ban |
| Maximum ban | Upper limit of a variable ban |
| Counting method | By time window / accumulated since the last unban |

Time entry rules:

```text
0          = permanent ban
blank      = no time limit, count only (fixed ban fields)
positive   = ban for that many minutes/hours
variable   = starts at 1, cannot be blank or 0
```

Variable ban calculation:

```text
ban duration = first ban × 2^(times over threshold)
ban duration does not exceed the maximum ban
```

For example:

```text
first ban 1 minute, maximum 60 minutes:
1st time over the limit 1 minute
2nd time 2 minutes
3rd time 4 minutes
...
capped at 60 minutes
```

When a fixed ban is left blank, the policy only counts and increases the ban count at the upper level; it does not ban the current feature directly.

#### 4.4 Feature Descriptions

| Feature | Available scopes | Effect |
|---|---|---|
| Login failure limit | IP / account | Counts login failures and restricts login after the threshold is reached |
| Registration volume limit | IP / global | Counts successful registrations within the time window |
| Cap human verification | IP / global | Requires completing PoW after the threshold is reached |
| Rename limit | Account / global | Limits the number of renames within the statistics period |
| Concurrent online users | Account / global | Limits the number of simultaneously connected clients |
| Historical IP count limit | Account / global | Limits the number of distinct login IPs seen within the period |
| Concurrent online IP limit | Account / global | Limits the number of distinct IPs online at the same time |
| IPS attack signature blocking | IP / global | On a match of XSS/SQLi/path traversal/command injection/scanner signatures, blocks only the current request and counts it |
| API flood blocking | IP / account / global | Counts `/api` requests per window; by default excludes health checks, task polling, current-user and Range requests |
| Count toward IP global ban counter | Global only | On IP-level triggers, adds the record value to the upper-level global counter |
| Count toward account global ban counter | Global only | On account-level triggers, adds the record value to the upper-level global counter |

#### 4.5 Global Bans, Counters and Lists

##### IP / account global bans

- IP threshold defaults to 10, ban for 30 minutes.
- Account threshold defaults to 10, ban for 30 minutes.
- Once the total record value of the feature restrictions for the same target reaches the threshold:
  - the feature bans for that target are cleared;
  - it is escalated to an IP/account global ban;
  - subsequent operations by that target are blocked.

##### Global policy

- Global counter threshold defaults to 15.
- Automatic recovery interval defaults to 5 minutes.
- Recovery interval 0 = no automatic recovery.
- After the global threshold is reached, the user Web is stopped automatically.
- Going offline does not clear IP/account bans.
- If the user Web is started manually during automatic recovery, the timer for that round of automatic recovery stops, to avoid a conflict.

##### Viewing current bans

Top-level tabs:

- Ban records
- Current counts

Counts include:

- Tab trigger counts
- IPS counts
- API flood counts
- Global counts

Individual and bulk clearing are supported; the counter window refreshes every 2 seconds.

"Unban All and Clear All Counts" deletes bans, clears counters, writes the reset time and resets the legacy failure counts to zero.

##### Blacklist and whitelist

- IP blacklist rejects immediately.
- IP whitelist skips global bans and automatic policy restrictions.
- The same applies to the account blacklist/whitelist.
- Changes take effect after saving the network security settings.

#### 4.6 Low-level Security Controls

Path:

```text
Advanced Mode → "Low-level Security Controls" at the bottom
```

All are enabled by default. Any change requires passing a red-warning second confirmation.

Notes:

- These restrictions are enforced before WAF policies.
- Values that are too small make the low-level layer block normal requests before the policies do.
- Network/plugin timeout parameters take full effect at the next service or plugin start.

##### Basic protection

| Field | Default | Unit |
|---|---:|---|
| Global API rate limit | 600 | times/minute |
| Upload rate limit | 120 | times/minute |
| Share creation rate limit | 10 | times/minute |
| Share download rate limit | 60 | times/minute |
| Extraction rate limit | 10 | times/minute |
| Scan rate limit | 10 | times/minute |
| IP registration limit | 2 | times/hour |

##### IO and resources

| Field | Default | Unit |
|---|---:|---|
| Single-file upload limit | 2 GiB | bytes |
| File list limit | 5000 | items |
| Batch operation limit | 100 | items |
| Text preview limit | 512 KiB | bytes |
| Extraction concurrency | 10 | tasks |
| Scan concurrency | 10 | tasks |
| Local ClamAV size limit | 100 MiB | bytes |
| Local ClamAV timeout | 300 | seconds |
| Front-end concurrent uploads | 10 | uploads |
| Upload drain limit | 16 MiB | bytes |
| Share validity limit | 7200 | seconds |

##### Lifecycle and network

| Field | Default | Unit |
|---|---:|---|
| User Session validity | 168 | hours |
| Online determination window | 300 | seconds |
| PROXY wait timeout | 3000 | milliseconds |
| frp health check timeout | 3 | seconds |
| frp health check interval | 10 | seconds |
| Minimum TLS version | TLS 1.2 | — |
| HTTP headers timeout | 60000 | milliseconds |
| HTTP request timeout | 300000 | milliseconds |

##### Plugins and IPC

| Field | Default | Unit |
|---|---:|---|
| Plugin start timeout | 10000 | milliseconds |
| Plugin request timeout | 15000 | milliseconds |

##### Hard red lines (display only)

- safePath path safety
- CSRF
- Password policy
- Zip-bomb protection base thresholds (10000 files / 50GB / 5 minutes)
- JSON 1MB limit
- Cookie Secure/HttpOnly

##### WAF conflict warning

If a WAF policy threshold is higher than the low-level limit, for example:

```text
API flood threshold 800 times/minute
low-level API rate limit 600 times/minute
```

the low-level layer returns 429 first and the policy does not trigger first. The panel displays a conflict warning.

#### 4.7 Local Resources and Logs

- Maximum concurrent extraction tasks: default 10.
- Maximum concurrent scan tasks: default 10.
- Global concurrency for heavy previews: default 10 (PDF/Office/large videos).
- Per-user preview concurrency: default 10.
- Log storage limit: default 100 MB.
- Clear cache: deletes temporary upload files and expired audit logs.
- Runtime log: recent logs of the current process.
- Audit log: operation records in the database.

### 5. Feature Controls

#### 5.1 User Web Self-Registration

- Master switch.
- When enabled, the user Web login page shows a registration entry.
- New users default to a normal user with a 5GB quota.
- In advanced mode, registration frequency is controlled by "Registration volume limit".
- Simple mode uses the registrations per IP per hour limit.

#### 5.2 User Feature Permissions

- Image online preview
- Video online playback
- PDF online preview
- Office online preview
- Online extraction
- Security scanning

When disabled, the front end hides the entry and the backend interface returns 403.

#### 5.3 Security Scanning

- Master switch
- Mode: local ClamAV / VirusTotal API
- VirusTotal API Key
- ClamAV directory
- In local mode, files over the size limit return `skipped`
- `infected` files cannot be downloaded, shared or extracted

#### 5.4 AI Service

- Master switch
- Admin shared configuration / user-provided configuration
- Base URL, model, API Key
- Daily limit for normal users

#### 5.5 Embedded Static Hosting

- Master switch
- Public base address
- Sites are mounted at `/host/`
- No additional listening port
- Port reuse relies on frp HTTP/HTTPS tunnels
- Supports public/private sites
- Hosted pages are isolated from the main site API

#### 5.6 Email Notifications

- Email master switch
- SMTP Host / Port / TLS
- SMTP user
- Authorization code/password
- Sender, alert recipient email
- Events: new user registration, security alert, security restriction trigger, local resource alert, system error
- Send test email

The password is encrypted with AES-256-GCM; if it cannot be decrypted, the authorization code must be re-entered.

### 6. System and Storage

#### 6.1 Startup and Tray (GUI)

- Start automatically at boot
- After auto-start, minimized to the tray
- Manual start still shows the main window

The Web Admin has no tray/auto-start settings; the Windows service handles this.

#### 6.2 Database Backup

- SQLite online backup
- Includes users, quotas, settings and audit logs
- Does not include the drive files themselves
- Backing up the database also backs up `ai-secret.key`
- GUI saves to the local machine
- Web downloads to the browser's device

#### 6.3 System Data Directory

Contains the database, certificates, CA, frp configuration and encryption keys.

- The GUI can change and migrate it.
- The Web Admin can change the directory by entering an absolute server path; the target directory must be empty.
- Changing the data directory copies `cloudbox.db`, `config` and `ai-secret.key`, then the service restarts automatically; to avoid losing the path pointer, the old database directory is not deleted automatically.
- Drive/plugin directories are cleaned up after migration completes and delete-old-files is checked.

#### 6.4 Drive File Directory

All user-uploaded files. Both GUI and Web can migrate it; Web uses an absolute path input, and the target directory must be empty.

#### 6.5 Plugin Directory

Installed plugins and their private storage. Both GUI and Web can migrate it; Web uses an absolute path input.

Data can be migrated when changing the directory; once migration completes and delete-old-files is checked, it cannot be undone. When the Web migrates the data directory, the old directory is kept because it holds the headless path pointer.

### 7. Network Settings

#### 7.1 User Web Online Mode

- GUI: the online mode switch controls the user Web.
- Web: the Admin Web always runs, and the user Web is controlled by the online mode switch.
- A fresh installation defaults to offline.

#### 7.2 Ports

- User port range 1024–65535.
- It cannot be 1250.
- After a change, the user Web restarts automatically when online.
- On failure, the port configuration is rolled back.

#### 7.3 HTTP / HTTPS

- HTTP is only recommended on a trusted LAN.
- HTTPS requires a certificate and private key.
- The GUI can import `.crt/.pem/.cer` and `.key/.pem`.
- The Web Admin uploads `.crt/.pem/.cer` and `.key/.pem` through the browser.
- CA client certificates are downloaded by the browser; the PKCS#12 password is `changeit`.
- With mTLS enabled, the browser must import the client certificate.

#### 7.4 frp

Fields:

| Field | Description |
|---|---|
| frps address | Server domain name or IP |
| frps port | Default 7000 |
| token | frps authentication token, may be left blank |
| User | frp user, may be left blank |
| Proxy name | frpc proxy name |
| Tunnel type | TCP / HTTP / HTTPS |
| Remote port | Used in TCP mode |
| Custom domain | Used in HTTP/HTTPS mode |
| PROXY Protocol v2 | Can be enabled for TCP/HTTPS, preserves the real IP |
| tcpMux | Health checks and business traffic share TCP |

Fixed health check parameters:

```text
timeoutSeconds = 3
maxFailed = 3
intervalSeconds = 10
```

The timeout/interval can be changed through the low-level security controls, but maxFailed is fixed at 3.

#### 7.5 Private CA and mTLS

- Create a private CA
- Install into the system trust store
- Issue a server certificate
- Export the client certificate (GUI)
- Uninstalling only removes the system trust; it does not delete the CA files
- Default client PKCS#12 password `changeit`

### 8. Users, Files and Plugins

#### User Management

- Create, delete users
- Set quotas (0 or blank means unlimited)
- Reset password (forced change at next login)
- Disable/enable
- Unlock
- Clear rename restrictions
- View historical IPs
- An administrator cannot delete themselves like a normal user

#### File Browsing (Admin, Read-Only)

- Browse all user directories
- Download files
- Paths are validated by safePath

#### Plugins

- Import plugins (GUI supports folders/ZIP; Web currently only manages existing plugins)
- Enable/stop
- Allow Web takeover
- Uninstall
- Open the plugin management page
- Plugins run in a separate child process

### 8.1 Automatic Updates

- After checking for updates, the admin end downloads the installer matching the current form (GUI Setup / Server).
- The download shows percentage and byte progress; on completion it verifies the size and the GitHub digest.
- After verification passes, the installer runs automatically for a silent overwrite installation and restarts the GUI or the Windows service.
- For the portable version, manually replacing the files is recommended; the development version is only used for verification.
- On failure it ends in the error state and the installation is not performed.

### 8.2 Uninstall and Data Retention

- Uninstalling from the system "Apps and features" or from the installation directory asks whether to delete user data.
- Choosing "No" keeps `%APPDATA%\cloudbox` and `%PROGRAMDATA%\CloudBox`; reinstalling restores them.
- Choosing "Yes" deletes accounts, files and configuration; it cannot be undone.
- Silent updates do not show this prompt and always keep the data.

### 9. Theme, Import/Export and Restore

- Light / dark theme
- Language switch (Chinese / English)
- Import/export configuration
- Restore default settings
- Restoring defaults clears security policies and runtime bans; please be careful

### 10. Common Blank-Field Questions

#### What does leaving a time field blank mean?

- Fixed ban time left blank: **count only, do not ban**.
- Enter `0`: **permanent ban**.
- Variable ban: **cannot be left blank or set to 0**, starts at 1.

#### What does leaving the quota blank mean?

A user quota that is left blank or set to 0 means **unlimited quota**.

#### What happens if the token is left blank?

Leaving the frp token blank means token authentication is not enabled; this is only recommended with a trusted frps.

#### Can the port be left blank?

No. The port must be an integer from 1024–65535 and cannot be 1250.

#### Can the admin Web be mapped through frp?

Not recommended. The admin Web has no built-in HTTPS, and a local frp connection bypasses `intranetOnly`. Map only the user Web.
