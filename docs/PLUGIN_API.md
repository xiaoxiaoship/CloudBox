# CloudBox 插件开发与 API / Plugin Development & API

> 适用版本：1.0.2  
> Applies to: 1.0.2

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
└── 12. English
```

---

# 中文

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
4. 用户访问 `/` 时返回该 HTML。

接管页面只能通过标准 `/api/*` 与后端通信（Session + CSRF），不能访问本地文件系统。CSP 由 CloudBox 设置，资源放在 `web-override/` 并通过 `/plugin-web/{name}/...` 引用。

## 9. 管理员设置页面

两种方式：

1. `admin-ui/index.html`：管理端通过 `plugin-admin://{name}/index.html` 沙箱 iframe 加载。
2. `manifest.adminUrl`：插件卡片右侧设置齿轮，调用系统浏览器打开 HTTP/HTTPS 页面。

选择 `adminUrl` 时，插件需要自行提供可访问的 Web 服务与鉴权。

## 10. 安全边界

- 独立子进程，不是虚拟机级隔离。
- 子进程环境变量仅保留最小集合。
- 插件路由请求经主进程鉴权和 CSRF。
- 插件 storage 由主进程创建，不能访问其他插件/用户文件。
- 导入 zip 会校验路径，拒绝 `../` 与绝对路径。
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

# English

## 1. Runtime model

Plugins run in a **separate child process**. The main process forwards HTTP requests, events and logs over IPC and never `require`s plugin code.

## 2. Directory layout

```text
plugins/
└── my-plugin/
    ├── manifest.json          # required
    ├── index.js               # required, exports activate(ctx)
    ├── admin-ui/
    │   └── index.html         # optional admin page
    ├── web-theme.css          # optional Web theme
    └── web-override/
        ├── index.html         # optional Web takeover
        └── assets...
```

## 3. manifest.json

```json
{
  "name": "ai-summary",
  "version": "1.0.0",
  "description": "External AI summary",
  "author": "CloudBox",
  "previews": [".json"],
  "adminUrl": "https://example.com/plugin-settings"
}
```

- `name`: lowercase letters/digits/hyphens, 2–64 chars.
- `version`: non-empty string.
- `description`, `author`: optional.
- `previews`: optional custom preview extensions.
- `adminUrl`: optional HTTP/HTTPS settings page; the plugin card shows a gear that opens the system browser.
- `admin-ui/index.html` also marks the plugin as having an admin page.

## 4. index.js and ctx

```js
module.exports = async function activate(ctx) {
  const router = ctx.createRouter();
  router.post('/generate', async (req) => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { ok: true, input: req.body },
  }));
  ctx.registerRouter('', router);
  ctx.on('file.uploaded', (payload) => ctx.logger.info('uploaded', payload.path));
};
```

Available: `ctx.createRouter()`, `ctx.registerRouter()`, `ctx.on()`, `ctx.storage`, `ctx.logger`, `ctx.manifest`.

## 5. HTTP routes

Mounted at `/api/plugins/{name}/{prefix}`.

Request:

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

Response: `{ status?, headers?, body? }`.

Requirements:

- A valid CloudBox session.
- CSRF token for non-GET/HEAD.
- 404 `PLUGIN_NOT_RUNNING` when disabled/not running.
- `PLUGIN_ERROR` for plugin exceptions; the main service stays up.

## 6. Events

- `file.uploaded`
- `file.deleted`
- `user.registered`
- `user.created`

Subscribe only; arbitrary event emission is not exposed.

## 7. Private storage

```text
plugins/.storage/{name}
```

```js
ctx.storage.get('apiKey', '');
ctx.storage.set('apiKey', '...');
ctx.storage.read('data.json');
ctx.storage.write('data.json', '{}');
ctx.storage.dir;
```

Plugins cannot read other plugins or user files through ctx.

## 8. Web theme and takeover

- `web-theme.css` is concatenated by `GET /api/public/plugin-theme.css` and injected into the Web `<head>`.
- `web-override/index.html` takes over `/` after enabling “allow this plugin to take over the Web UI” and confirming the warning.
- Hosted pages only communicate via `/api/*` with session + CSRF; CSP is set by CloudBox. Assets live in `web-override/` and are served through `/plugin-web/{name}/...`.

## 9. Admin page

1. `admin-ui/index.html` is loaded in a sandboxed iframe via `plugin-admin://{name}/index.html`.
2. `manifest.adminUrl` opens an HTTP/HTTPS page in the system browser from the plugin card gear.

With `adminUrl`, the plugin must provide its own reachable Web service and authentication.

## 10. Security boundary

- Separate child process, not VM-level isolation.
- Minimal environment variables.
- Main-process authentication and CSRF for plugin routes.
- Private storage per plugin.
- Zip imports reject `../` and absolute paths.
- Enable/disable, takeover and uninstall write audit logs.
- Install only trusted plugins, especially takeover plugins.

## 11. Examples

- `resources/plugins/ai-summary`: external AI summary + admin UI.
- `resources/plugins/dark-neon-theme`: CSS theme injection.
- Development: `npm run build:desktop && npm run electron:start`; main logs show `[plugin:name]` output.
