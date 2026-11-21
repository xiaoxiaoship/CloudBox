# CloudBox 配置指南 / Configuration Guide

> 适用版本：1.0.2  
> Applies to: 1.0.2

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
11. English
```

---

# 中文

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
| 目录迁移 | 支持 | 不支持 |
| 插件文件夹导入 | 支持 | 不支持 |
| 证书/私钥导入 | 支持 | 不支持 |
| CA 客户端证书导出 | 支持 | 暂不支持 |
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

> Web 管理版当前 `auth.changePassword` HTTP 适配尚未实现；Web 端修改密码会返回未实现错误，请在 GUI 修改。

### 管理员 GUI 空闲锁定

- 默认为开启。
- 默认 30 分钟。
- 取值范围 1–1440 分钟。
- 无操作后管理员前端自动退出，需要重新登录。
- 该锁定是前端计时器；服务端 Session 仍按 Session TTL 失效。

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
| Session 有效期 | 168 | 小时 |
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
- Web 管理版只读，不支持修改服务器目录。

### 6.4 网盘文件目录

所有用户上传文件。GUI 可迁移；Web 只读。

### 6.5 插件目录

已安装插件及其私有 storage。GUI 可迁移；Web 只读。

修改目录时可迁移数据；迁移完成并勾选删除旧文件后不可撤销。

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
- Web 管理版暂不支持证书导入。
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

# English

## 1. GUI vs Web Admin

| Capability | Electron GUI | Web Admin |
|---|---|---|
| Entry | Desktop window | Browser `:1250` |
| Login | First-run wizard + GUI login | `/setup?token=...`, then login |
| Session | Electron memory | `admin_sessions` table |
| API | Electron IPC | HTTP `/api/admin/*` |
| Data dir | `%APPDATA%\cloudbox` | `%PROGRAMDATA%\CloudBox` |
| User Web | GUI online switch | Web online switch; admin Web always on |
| File picker | Yes | No |
| Directory migration | Yes | No |
| Plugin folder import | Yes | No |
| Certificate import | Yes | No |
| CA client export | Yes | Not yet |
| DB backup | Save locally | Download to browser |
| Admin LAN restriction | N/A | On by default, can be disabled |

**Never expose admin Web 1250 through frp.** Only expose the user Web port.

## 2. First start

GUI: create the administrator in the wizard. Web: install the service, read the one-time `/setup?token=...` URL from logs, create the admin within 24 hours.

Token file: `%PROGRAMDATA%\CloudBox\config\admin-init-token.json`. Delete it and restart to regenerate.

## 3. Administrator

- Username 1–64 chars, no spaces or `/ \ : * ? " < > |`.
- Password: at least 8 chars, letter + digit.
- GUI idle lock: default 30 minutes, 1–1440.
- Web Admin LAN-only: default on; disable requires a red confirmation.
- Web Admin password change / self rename are not implemented in the HTTP adapter; use the GUI.

## 4. Security

### Simple mode

Account lock threshold 5, first lock 1 min, max 60 min; IP login limit 30/15 min, lock 15 min; registration 2/hour/IP; rename 1/24h, lock 24h.

Simple mode does not run policy cards or IPS.

### Advanced mode

Scopes: IP / account / global. Drag a feature card into a scope to enable it; drag to “saved but disabled” to keep parameters and disable it; drag outside to delete with confirmation.

Time fields:

```text
0        = permanent
blank    = count only, no ban (fixed duration fields)
positive = fixed duration
variable = starts at 1, cannot be blank/0
```

Variable duration = `base × 2^(over threshold)`, capped by max.

Features: login failure, registration, Cap, rename, concurrent sessions, historical IPs, concurrent IPs, IPS, API flood, global IP ban counter, global account ban counter.

Defaults: IP login failure 30/15 min fixed 5; account login failure 10/15 min variable base 1 max 60; account concurrent sessions 10, ban 5; rename 3/24h, ban 24h; Cap 3/15 min; API flood 256/min; IPS record 5; global sessions 500, ban 5; registration 2/10 min, ban 10.

IP/account global-ban threshold 10, 30 min. Global threshold 15, recovery 5 min; `0` recovery means no automatic recovery. Reaching the global threshold stops user Web; a manual start cancels the pending recovery.

IPS blocks only the current request. API flood excludes health, task polling, current-user and Range requests.

### Low-level controls

Defaults:

```text
API 600/min; upload 120/min; share create 10/min; share download 60/min;
extract 10/min; scan 10/min; registration 2/hour
file 2GiB; list 5000; batch 100; text preview 512KiB;
extract/scan concurrency 10; ClamAV 100MiB/300s;
upload queue 10; drain 16MiB; share max 7200s
session 168h; online window 300s; PROXY 3000ms;
frp health 3s/10s; TLS 1.2; headers 60000ms; request 300000ms
plugin start 10000ms; plugin request 15000ms
```

Red lines: safePath, CSRF, password policy, zip-bomb limits, JSON 1MB, Cookie Secure/HttpOnly.

## 5. Feature controls

Registration, user permissions, ClamAV/VirusTotal, AI, hosting, mail. Mail passwords are encrypted with AES-256-GCM.

## 6. System and storage

GUI can migrate data/drive/plugin directories and save database backups locally. Web can download a backup to the browser, but cannot change server directories.

## 7. Network

User Web port 1024–65535, never 1250. GUI supports certificate import; Web does not yet. frp fields: server, port, token, user, proxy name, tunnel type, remote port/custom domain, PROXY v2, tcpMux. frp is for user Web only.

## 8–10. Users, files, plugins, common blanks

Admins manage users, quotas (blank/0 = unlimited), password resets, bans, history IPs, read-only user files and plugins. Blank fixed time means count-only; `0` means permanent; variable time starts at 1. Never map 1250 through frp.
