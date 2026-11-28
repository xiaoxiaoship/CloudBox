# CloudBox 插件开发与 API / Plugin Development & API

> 适用版本：1.0.3  
> Applies to: 1.0.3

## 本文目录 / Contents

```text
插件开发与 API
├── 1. 运行模型
├── 2. 目录结构
├── 3. manifest.json
├── 4. index.js 与 ctx
├── 5. HTTP 路由
├── 6. 事件
├── 7. 私有 storage
├── 8. Web 主题与 Web 接管
├── 9. 管理员设置页面
├── 10. 安全边界
├── 11. 示例
```

---

## 1. 运行模型

插件运行在**独立子进程**中，主进程通过 IPC 转发请求、事件和日志，不 `require` 插件代码。

```text
CloudBox 主进程
  └── child_process.fork(插件 index.js)
        ├── HTTP 路由请求
        ├── 核心事件
        └── 插件日志
```

插件崩溃不会直接拖垮主进程；禁用插件会发送 shutdown 并结束子进程。

## 2. 目录结构

```text
plugins/
└── my-plugin/
    ├── manifest.json          # 必需
    ├── index.js               # 必需，导出 activate(ctx)
    ├── admin-ui/
    │   └── index.html         # 可选，管理员设置页面
    ├── web-theme.css          # 可选，注入 Web 主题
    └── web-override/
        ├── index.html         # 可选，接管 Web 首页
        └── assets...
```

插件安装目录默认为“系统设置 → 插件目录”。

## 3. manifest.json

```json
{
  "name": "ai-summary",
  "version": "1.0.0",
  "description": "调用外部 AI 生成摘要",
  "author": "CloudBox",
  "previews": [".json"],
  "adminUrl": "https://example.com/plugin-settings"
}
```

字段：

- `name`：小写字母/数字/短横线，2–64 字符，用作目录名和 URL 的一部分。
- `version`：非空字符串。
- `description` / `author`：可选。
- `previews`：可选，声明自定义预览扩展名。
- `adminUrl`：可选，HTTP/HTTPS 设置页面；配置后插件卡片显示设置齿轮并调用系统浏览器打开。
- 如果存在 `admin-ui/index.html`，也视为有设置页面。

## 4. index.js 与 ctx

```js
module.exports = async function activate(ctx) {
  const router = ctx.createRouter();

  router.post('/generate', async (req) => {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true, input: req.body },
    };
  });

  ctx.registerRouter('', router);

  ctx.on('file.uploaded', (payload) => {
    ctx.logger.info('uploaded', payload.path);
  });
};
```

### ctx 提供

- `ctx.createRouter()`
- `ctx.registerRouter(prefix, router)`
- `ctx.on(event, handler)`
- `ctx.storage`
- `ctx.logger`
- `ctx.manifest`

## 5. HTTP 路由

路由挂载到：

```text
/api/plugins/{name}/{prefix}
```

请求对象：

```ts
{
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  user: { id: number; username: string; role: string } | null;
}
```

返回：

```ts
{
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}
```

示例：

```http
POST /api/plugins/ai-summary/generate
Content-Type: application/json
Cookie: cloudbox_session=...
X-CSRF-Token: ...

{"text":"需要总结的文本"}
```

约束：

- 需要 CloudBox 登录 Session。
- 非 GET/HEAD 请求需要 CSRF Token。
- 插件未启用/未运行返回 404 `PLUGIN_NOT_RUNNING`。
- 插件异常返回 `PLUGIN_ERROR`，不影响主服务。

## 6. 事件

可用事件：

- `file.uploaded`
- `file.deleted`
- `user.registered`
- `user.created`

插件只能订阅，不支持向主进程发送任意事件。

## 7. 私有 storage

每个插件有独立目录：

```text
plugins/.storage/{name}
```

API：

```js
ctx.storage.get('apiKey', '');
ctx.storage.set('apiKey', '...');
ctx.storage.read('data.json');
ctx.storage.write('data.json', '{}');
ctx.storage.dir;
```

插件不能通过 ctx 读取其他插件或用户文件。

## 8. Web 主题与 Web 接管

### 主题

放置 `web-theme.css`，启用后由：

```http
GET /api/public/plugin-theme.css
```

返回所有已启用主题的拼接结果，并注入 Web `<head>`。

### Web 接管

1. 插件包含 `web-override/index.html`。
2. 启用插件。
3. 在插件页打开“允许此插件接管 Web 界面”，确认红色警告。
4. 用户访问 `/` 时，CloudBox 用 sandbox iframe 包装该 HTML；页面不再直接替换主文档。

接管页面只能通过标准 `/api/*` 与后端通信（Session + CSRF），不能访问本地文件系统。CSP 由 CloudBox 设置，资源放在 `web-override/` 并通过 `/plugin-web/{name}/...` 引用。

## 9. 管理员设置页面

两种方式：

1. `admin-ui/index.html`：
   - Electron GUI：通过 `plugin-admin://{name}/index.html` 沙箱 iframe 加载。
   - Web 管理版：通过 `/api/admin/plugins/{name}/admin/index.html` 加载，受管理员 Session 保护。
2. `manifest.adminUrl`：插件卡片右侧设置齿轮，调用系统浏览器打开 HTTP/HTTPS 页面。

选择 `adminUrl` 时，插件需要自行提供可访问的 Web 服务与鉴权。

## 10. 安全边界

- 独立子进程，不是虚拟机级隔离。
- 子进程环境变量仅保留最小集合。
- 插件路由请求经主进程鉴权和 CSRF。
- 插件 storage 由主进程创建，不能访问其他插件/用户文件。
- 导入 ZIP 会校验路径，拒绝 `../` 与绝对路径；ZIP 最大 20MB、最多 2000 条目。
- Web 管理版支持从浏览器上传 ZIP；文件夹导入仍仅 GUI 支持。
- 启用/禁用、Web 接管、卸载都会写审计日志。
- 只安装可信插件，尤其是需要 Web 接管的插件。

## 11. 示例

- `resources/plugins/ai-summary`：外部 AI 摘要 + admin-ui。
- `resources/plugins/dark-neon-theme`：CSS 主题注入。
- 插件开发调试：

```bash
npm run build:desktop
npm run electron:start
```

主进程日志会打印 `[plugin:name]` 的 stdout/stderr 和 logger。

---

---

# English

## CloudBox Plugin Development & API

> Applies to version: 1.0.3  

### Contents

```text
Plugin Development & API
├── 1. Runtime model
├── 2. Directory layout
├── 3. manifest.json
├── 4. index.js and ctx
├── 5. HTTP routes
├── 6. Events
├── 7. Private storage
├── 8. Web theme and Web takeover
├── 9. Admin settings page
├── 10. Security boundaries
├── 11. Examples
```

---

### 1. Runtime model

Plugins run in a **separate child process**. The main process forwards requests, events and logs over IPC and never `require`s plugin code.

```text
CloudBox main process
  └── child_process.fork(plugin index.js)
        ├── HTTP route requests
        ├── core events
        └── plugin logs
```

A plugin crash does not directly bring down the main process; disabling a plugin sends shutdown and terminates the child process.

### 2. Directory layout

```text
plugins/
└── my-plugin/
    ├── manifest.json          # required
    ├── index.js               # required, exports activate(ctx)
    ├── admin-ui/
    │   └── index.html         # optional, admin settings page
    ├── web-theme.css          # optional, injects a Web theme
    └── web-override/
        ├── index.html         # optional, custom page wrapped in a sandbox iframe
        └── assets...
```

The plugin installation directory defaults to "System Settings → Plugin Directory".

### 3. manifest.json

```json
{
  "name": "ai-summary",
  "version": "1.0.0",
  "description": "Generate summaries with an external AI",
  "author": "CloudBox",
  "previews": [".json"],
  "adminUrl": "https://example.com/plugin-settings"
}
```

Fields:

- `name`: lowercase letters/digits/hyphens, 2–64 characters, used as the directory name and as part of the URL.
- `version`: non-empty string.
- `description` / `author`: optional.
- `previews`: optional, declares custom preview extensions.
- `adminUrl`: optional HTTP/HTTPS settings page; once configured, the plugin card shows a settings gear and calls the system browser to open it.
- If `admin-ui/index.html` exists, the plugin is also considered to have a settings page.

### 4. index.js and ctx

```js
module.exports = async function activate(ctx) {
  const router = ctx.createRouter();

  router.post('/generate', async (req) => {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true, input: req.body },
    };
  });

  ctx.registerRouter('', router);

  ctx.on('file.uploaded', (payload) => {
    ctx.logger.info('uploaded', payload.path);
  });
};
```

#### What ctx provides

- `ctx.createRouter()`
- `ctx.registerRouter(prefix, router)`
- `ctx.on(event, handler)`
- `ctx.storage`
- `ctx.logger`
- `ctx.manifest`

### 5. HTTP routes

Routes are mounted at:

```text
/api/plugins/{name}/{prefix}
```

Request object:

```ts
{
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  user: { id: number; username: string; role: string } | null;
}
```

Response:

```ts
{
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}
```

Example:

```http
POST /api/plugins/ai-summary/generate
Content-Type: application/json
Cookie: cloudbox_session=...
X-CSRF-Token: ...

{"text":"text to summarize"}
```

Constraints:

- A CloudBox login session is required.
- Non-GET/HEAD requests require a CSRF token.
- If the plugin is not enabled/not running, returns 404 `PLUGIN_NOT_RUNNING`.
- Plugin exceptions return `PLUGIN_ERROR` and do not affect the main service.

### 6. Events

Available events:

- `file.uploaded`
- `file.deleted`
- `user.registered`
- `user.created`

Plugins can only subscribe; sending arbitrary events to the main process is not supported.

### 7. Private storage

Each plugin has its own directory:

```text
plugins/.storage/{name}
```

API:

```js
ctx.storage.get('apiKey', '');
ctx.storage.set('apiKey', '...');
ctx.storage.read('data.json');
ctx.storage.write('data.json', '{}');
ctx.storage.dir;
```

Plugins cannot read other plugins' or users' files through ctx.

### 8. Web theme and Web takeover

#### Theme

Place `web-theme.css`; once enabled, it is served by:

```http
GET /api/public/plugin-theme.css
```

The route returns the concatenation of all enabled themes and injects it into the Web `<head>`.

#### Web takeover

1. The plugin contains `web-override/index.html`.
2. Enable the plugin.
3. On the plugin page, turn on "Allow this plugin to take over the Web UI" and confirm the red warning.
4. When a user visits `/`, that HTML is returned.

Takeover pages can only communicate with the backend through standard `/api/*` (session + CSRF) and cannot access the local file system. CSP is set by CloudBox; assets go in `web-override/` and are referenced through `/plugin-web/{name}/...`.

### 9. Admin settings page

Two ways:

1. `admin-ui/index.html`:
   - Electron GUI: loaded in a sandboxed iframe via `plugin-admin://{name}/index.html`.
   - Web Admin edition: loaded via `/api/admin/plugins/{name}/admin/index.html`, protected by the admin session.
2. `manifest.adminUrl`: the settings gear on the right side of the plugin card calls the system browser to open the HTTP/HTTPS page.

When choosing `adminUrl`, the plugin must provide its own reachable Web service and authentication.

### 10. Security boundaries

- Separate child process, not VM-level isolation.
- The child process keeps only a minimal set of environment variables.
- Plugin route requests go through the main process's authentication and CSRF checks.
- Plugin storage is created by the main process and cannot access other plugins' or users' files.
- Importing a ZIP validates paths and rejects `../` and absolute paths; ZIPs are at most 20MB with at most 2000 entries.
- The Web Admin edition supports uploading a ZIP from the browser; folder import is still supported only in the GUI.
- Enabling/disabling, Web takeover and uninstalling all write audit logs.
- Install only trusted plugins, especially those that need Web takeover.

### 11. Examples

- `resources/plugins/ai-summary`: external AI summary + admin-ui.
- `resources/plugins/dark-neon-theme`: CSS theme injection.
- Plugin development and debugging:

```bash
npm run build:desktop
npm run electron:start
```

The main process logs print the `[plugin:name]` stdout/stderr and logger.

---

## 12. 平台级 ctx API（1.0.3）

插件通过宿主白名单 RPC 使用以下能力；均为 Promise：

| 分类 | API | 说明 |
|---|---|---|
| 配置 | `ctx.config.get/set` | 插件私有配置 |
| 调度 | `ctx.schedule(cron, handler)` | 5 段 cron，进程内执行 |
| 系统 | `ctx.system.getStats()` | CPU、内存、在线人数、uptime |
| 安全只读 | `ctx.security.getBannedList()` | 当前封禁列表；无写接口 |
| 日志 | `ctx.logger.info/warn/error` | 转发到主进程日志 |
| 用户 | `getInfo / updateQuota / getMeta / setMeta` | 配额、64KB JSON 元数据 |
| 文件 | `read / write / list / getUrl` | 文本读写、目录、1 小时内部直链；全部 safePath |
| AI | `registerTool / injectPrompt` | 注册工具和系统提示词 |
| 事件 | `ctx.on(event, handler)` | file.uploaded、security.banned 等 |
| UI | `ctx.ui.registerComponent` | Web 悬浮按钮，sandbox iframe |

插件页面放在 `web-ui/index.html`，宿主通过 `postMessage` 发送：

```js
{ type: 'cloudbox:init', token, user: { id, username, role } }
```

不能调用：修改 WAF/安全模式、封禁/解封、清除安全计数。

## 12. Platform ctx API (1.0.3)

All capabilities are asynchronous and whitelisted by the host:

| Category | API | Notes |
|---|---|---|
| Config | `ctx.config.get/set` | Per-plugin storage |
| Scheduling | `ctx.schedule(cron, handler)` | 5-field cron, child-process timer |
| System | `ctx.system.getStats()` | CPU, memory, online users, uptime |
| Security (read-only) | `ctx.security.getBannedList()` | No ban/unban/WAF write API |
| Logging | `ctx.logger.info/warn/error` | Forwarded to host logs |
| Users | `getInfo / updateQuota / getMeta / setMeta` | Quota and 64KB JSON metadata |
| Files | `read / write / list / getUrl` | UTF-8 text, safePath, 1-hour internal link |
| AI | `registerTool / injectPrompt` | Native assistant tools/prompts |
| Events | `ctx.on(event, handler)` | `file.uploaded`, `security.banned`, etc. |
| UI | `ctx.ui.registerComponent` | Web slot rendered in a sandbox iframe |

Custom UI lives in `web-ui/index.html`; the host posts:

```js
{ type: 'cloudbox:init', token, user: { id, username, role } }
```

Forbidden: modifying WAF/security mode, banning/unbanning, clearing security counters.
