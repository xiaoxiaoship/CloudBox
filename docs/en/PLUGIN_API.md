[中文](../PLUGIN_API.md) | English

# CloudBox Plugin Development & API

> Applies to version: 1.0.2  

## Contents

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

## 1. Runtime model

Plugins run in a **separate child process**. The main process forwards requests, events and logs over IPC and never `require`s plugin code.

```text
CloudBox main process
  └── child_process.fork(plugin index.js)
        ├── HTTP route requests
        ├── core events
        └── plugin logs
```

A plugin crash does not directly bring down the main process; disabling a plugin sends shutdown and terminates the child process.

## 2. Directory layout

```text
plugins/
└── my-plugin/
    ├── manifest.json          # required
    ├── index.js               # required, exports activate(ctx)
    ├── admin-ui/
    │   └── index.html         # optional, admin settings page
    ├── web-theme.css          # optional, injects a Web theme
    └── web-override/
        ├── index.html         # optional, takes over the Web home page
        └── assets...
```

The plugin installation directory defaults to "System Settings → Plugin Directory".

## 3. manifest.json

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

## 4. index.js and ctx

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

### What ctx provides

- `ctx.createRouter()`
- `ctx.registerRouter(prefix, router)`
- `ctx.on(event, handler)`
- `ctx.storage`
- `ctx.logger`
- `ctx.manifest`

## 5. HTTP routes

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

## 6. Events

Available events:

- `file.uploaded`
- `file.deleted`
- `user.registered`
- `user.created`

Plugins can only subscribe; sending arbitrary events to the main process is not supported.

## 7. Private storage

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

## 8. Web theme and Web takeover

### Theme

Place `web-theme.css`; once enabled, it is served by:

```http
GET /api/public/plugin-theme.css
```

The route returns the concatenation of all enabled themes and injects it into the Web `<head>`.

### Web takeover

1. The plugin contains `web-override/index.html`.
2. Enable the plugin.
3. On the plugin page, turn on "Allow this plugin to take over the Web UI" and confirm the red warning.
4. When a user visits `/`, that HTML is returned.

Takeover pages can only communicate with the backend through standard `/api/*` (session + CSRF) and cannot access the local file system. CSP is set by CloudBox; assets go in `web-override/` and are referenced through `/plugin-web/{name}/...`.

## 9. Admin settings page

Two ways:

1. `admin-ui/index.html`:
   - Electron GUI: loaded in a sandboxed iframe via `plugin-admin://{name}/index.html`.
   - Web Admin edition: loaded via `/api/admin/plugins/{name}/admin/index.html`, protected by the admin session.
2. `manifest.adminUrl`: the settings gear on the right side of the plugin card calls the system browser to open the HTTP/HTTPS page.

When choosing `adminUrl`, the plugin must provide its own reachable Web service and authentication.

## 10. Security boundaries

- Separate child process, not VM-level isolation.
- The child process keeps only a minimal set of environment variables.
- Plugin route requests go through the main process's authentication and CSRF checks.
- Plugin storage is created by the main process and cannot access other plugins' or users' files.
- Importing a ZIP validates paths and rejects `../` and absolute paths; ZIPs are at most 20MB with at most 2000 entries.
- The Web Admin edition supports uploading a ZIP from the browser; folder import is still supported only in the GUI.
- Enabling/disabling, Web takeover and uninstalling all write audit logs.
- Install only trusted plugins, especially those that need Web takeover.

## 11. Examples

- `resources/plugins/ai-summary`: external AI summary + admin-ui.
- `resources/plugins/dark-neon-theme`: CSS theme injection.
- Plugin development and debugging:

```bash
npm run build:desktop
npm run electron:start
```

The main process logs print the `[plugin:name]` stdout/stderr and logger.
