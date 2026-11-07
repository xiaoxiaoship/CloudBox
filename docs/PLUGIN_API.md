# CloudBox Plugin API

CloudBox 插件在**独立子进程**中运行。主进程只通过 IPC 转发 HTTP 请求、核心事件与日志，**不会 `require` 插件代码**。

## 1. 目录结构

```text
plugins/
└─ my-plugin/
   ├─ manifest.json          # 必需
   ├─ index.js               # 必需，导出 activate(ctx)
   ├─ admin-ui/
   │  └─ index.html          # 可选，管理员 GUI iframe
   ├─ web-theme.css          # 可选，注入用户 Web <head>
   └─ web-override/
      ├─ index.html          # 可选，完全接管 Web 首页
      └─ assets...
```

## 2. manifest.json

```json
{
  "name": "ai-summary",
  "version": "1.0.0",
  "description": "调用外部 AI 生成摘要",
  "author": "CloudBox"
}
```

- `name`：小写字母/数字/短横线，2–64 字符，同时作为插件目录名与 URL 的一部分。
- `version`：非空字符串。
- `description` / `author`：可选。

## 3. index.js 与受限 ctx

```js
module.exports = async function activate(ctx) {
  const router = ctx.createRouter();

  router.post('/generate', async (req) => {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    };
  });

  ctx.registerRouter('', router);
  ctx.on('file.uploaded', (payload) => {
    ctx.logger.info('uploaded', payload.path);
  });
};
```

### `ctx.registerRouter(prefix, router)`

把路由挂载到 `/api/plugins/{name}/`。

- `prefix` 相对插件 mount，例如 `/generate`。
- `router` 由 `ctx.createRouter()` 创建，支持 `get/post/put/patch/delete/all`。
- 路由 handler 返回 `{ status?, headers?, body? }`；也可直接返回 JSON body。
- `req` 结构：

```ts
{
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  user: { id, username, role } | null;
}
```

### `ctx.on(event, handler)`

支持的核心事件：

- `file.uploaded`
- `file.deleted`
- `user.registered`
- `user.created`

### `ctx.storage`

插件专属目录（`plugins/.storage/{name}`）：

```js
ctx.storage.get('apiKey', '');
ctx.storage.set('apiKey', '...');
ctx.storage.read('data.json');
ctx.storage.write('data.json', '{}');
ctx.storage.dir;
```

### `ctx.logger`

`ctx.logger.info/warn/error(...)` 输出会以 `[plugin:name:level]` 写入主进程日志。

### `ctx.manifest`

当前插件的 `manifest.json` 内容。

## 4. 核心 REST API

### 调用插件路由

```http
POST /api/plugins/ai-summary/generate
Content-Type: application/json
Cookie: cloudbox_session=...
X-CSRF-Token: ...

{"text":"需要总结的文本"}
```

响应：

```json
{
  "summary": "...",
  "model": "gpt-4o-mini"
}
```

- 插件 API 必须携带用户 Session。
- 非 GET/HEAD 请求需要 CloudBox CSRF Token。
- 未启用/未运行的插件返回 404 `PLUGIN_NOT_RUNNING`。

### 主题

```http
GET /api/public/plugin-theme.css
```

返回所有已启用插件的 `web-theme.css` 拼接结果。

### Web 接管资源

```http
GET /plugin-web/{name}/{asset}
```

只读取该插件 `web-override/` 内的文件，禁止路径穿越。

## 5. 前端扩展

### CSS 注入

启用含 `web-theme.css` 的插件后，CloudBox 会在返回的 HTML `<head>` 注入：

```html
<link rel="stylesheet" href="/api/public/plugin-theme.css" />
```

### 完全接管

1. 插件包含 `web-override/index.html`。
2. 启用插件。
3. 在“插件”页打开“允许此插件接管 Web 界面”，确认红色安全警告。
4. 用户访问 `/` 时返回该 HTML。

被接管页面只能通过标准 `/api/*` 与后端通信（Session + CSRF），不能访问本地文件系统。页面 CSP 由 CloudBox 设置，资源应放在 `web-override/` 并通过 `/plugin-web/{name}/...` 引用。

### 管理员配置页 iframe

插件可提供 `admin-ui/index.html`。管理端通过 `plugin-admin://{name}/index.html` 沙箱 iframe 加载，`sandbox="allow-scripts allow-forms"`。

## 6. 安全边界

- 插件在 `child_process.fork` 子进程中运行，主进程不加载插件代码。
- 子进程环境变量仅保留 PATH/SystemRoot/TEMP 等最小集合。
- 插件路由请求经 IPC 转发，必须经过 CloudBox 鉴权与 CSRF。
- 插件专属 storage 目录由主进程创建；插件不能通过 ctx 访问其他插件/用户文件。
- 导入 zip 会逐条校验路径，拒绝 `../` 与绝对路径。
- 启用/禁用、Web 接管、卸载均写入审计日志。

> 说明：Node 子进程提供进程级隔离和受限 API；它不是虚拟机级安全边界。只安装可信插件，尤其是需要开启 Web 接管的插件。

## 7. 调试

```bash
npm run build:desktop
npm run electron:start
```

- 主进程日志会打印 `[plugin:name]` 的 stdout/stderr 与 logger 输出。
- 插件抛错会让对应请求返回 `PLUGIN_ERROR`，不会影响主服务。
- 禁用插件会发送 shutdown 并终止子进程；再次启用会重新 fork。
- 导入后默认禁用，确认 manifest 与代码后再启用。

## 8. 示例插件

- `resources/plugins/ai-summary`：外部 AI 摘要 + admin-ui。
- `resources/plugins/dark-neon-theme`：CSS 主题注入。

导入 `resources/plugins` 下的目录，启用后在“插件”页查看。
