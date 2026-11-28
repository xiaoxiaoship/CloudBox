# CloudBox 插件开发 / Plugin Development

适用版本 / Applies to: **1.0.3**

---

# 中文

## 1. 运行模型

插件运行在独立子进程中，由主进程通过 IPC 转发 HTTP、事件、日志和能力调用。插件不能直接访问主进程对象，也不能修改 WAF、安全模式、封禁/解封或安全计数。

```text
CloudBox 主进程
  └── fork(插件/index.js)
        ├── 插件 HTTP 路由
        ├── 核心事件
        ├── ctx 能力 RPC（白名单）
        └── 日志
```

## 2. 目录结构

```text
plugins/
└── my-plugin/
    ├── manifest.json          # 必需
    ├── index.js               # 必需，导出 activate(ctx)
    ├── package.json           # 可选；CommonJS 插件建议声明 "type":"commonjs"
    ├── web-theme.css          # 可选，注入用户 Web 主题
    ├── web-override/          # 可选，整页接管（沙箱 iframe）
    ├── web-ui/                # 可选，插件自定义 UI（沙箱 iframe）
    │   └── index.html
    └── admin-ui/index.html    # 可选，管理端设置页
```

## 3. manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件说明",
  "author": "Your Name",
  "previews": [".json"],
  "adminUrl": "https://example.com/settings"
}
```

- `name`：小写字母/数字/短横线，2–64 字符，同时是目录名和 URL 标识。
- `version`：非空字符串。
- `previews`：声明插件可预览的扩展名。
- `adminUrl` 或 `admin-ui/index.html`：插件设置入口。

## 4. activate(ctx)

```js
module.exports = async function activate(ctx) {
  ctx.logger.info('plugin started');
};
```

`ctx` 是唯一的能力入口。所有异步能力都返回 Promise；调用失败会抛出错误。

## 5. 配置、日志、定时任务

```js
ctx.config.get(key, fallback);
ctx.config.set(key, value);

ctx.logger.info('message');
ctx.logger.warn('message');
ctx.logger.error('message');

ctx.schedule('*/5 * * * *', async () => {
  // 标准 5 段 cron；插件进程内执行，重启后需重新注册
});
```

配置保存在插件私有目录，不会和其他插件共享。

## 6. 系统与只读安全状态

```js
const stats = await ctx.system.getStats();
// { cpu, memory, processMemory, onlineUsers, uptimeSeconds, platform }

const bans = await ctx.security.getBannedList();
// [{ id, scope, target, feature, until, createdAt }]
```

安全边界：

- `getBannedList()` 是只读能力。
- 不提供修改 WAF/安全模式、封禁、解封、清除安全计数的 API。
- 不要尝试通过插件 HTTP 路由绕过该边界。

## 7. 用户与用户元数据

```js
const user = await ctx.user.getInfo(userId);
// 不含密码哈希等敏感字段

await ctx.user.updateQuota(userId, bytes); // null = 不限量
await ctx.user.setMeta(userId, 'profile', { theme: 'dark' });
const meta = await ctx.user.getMeta(userId, 'profile');
```

元数据键只允许字母/数字/点/下划线/短横线，单条值上限 64KB。元数据存储在 CloudBox 数据库中。

## 8. 文件与直链

所有路径都经过 `safePath` 校验，禁止绝对路径、`..`、符号链接/Junction 越界。

```js
const content = await ctx.file.read(userId, 'notes/a.txt');
await ctx.file.write(userId, 'notes/a.txt', 'hello');
const listing = await ctx.file.list(userId, 'notes');
const link = await ctx.file.getUrl(userId, 'notes/a.txt');
// { token, url, expiresAt }，内部直链默认 1 小时
```

`file.read/write` 仅处理 UTF-8 文本；二进制文件请通过插件自己的 HTTP 路由和标准文件 API 处理。

## 9. AI 工具与提示词

```js
await ctx.ai.registerTool(
  'summarize_text',
  '总结传入的文本',
  {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  async (args) => ({ summary: String(args.text).slice(0, 100) }),
);

ctx.ai.injectPrompt('该插件提供文本摘要能力。');
```

已注册工具会进入原生 AI 助手工具列表；调用时由宿主通过 IPC 转回插件 handler。

## 10. 事件

```js
ctx.on('file.uploaded', (payload) => {});
ctx.on('file.deleted', (payload) => {});
ctx.on('user.registered', (payload) => {});
ctx.on('user.created', (payload) => {});
ctx.on('security.banned', (payload) => {});
```

事件是单向通知；插件不能伪造或向其他插件广播事件。

## 11. HTTP 路由

```js
const router = ctx.createRouter();
router.get('/status', async () => ({ body: { ok: true } }));
router.post('/run', async (req) => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: { user: req.user, input: req.body },
}));
ctx.registerRouter('', router);
```

挂载前缀：

```text
/api/plugins/{manifest.name}{prefix}
```

需要登录用户；写请求需要 CSRF。插件未启用/未运行时返回 `PLUGIN_NOT_RUNNING`。

## 12. UI 注入与 iframe 沙箱

```js
await ctx.ui.registerComponent({
  id: 'my-button',
  title: '打开面板',
  icon: 'sparkles',
  position: 'bottom-right', // bottom-right | bottom-left | sidebar
});
```

配套文件：

```text
web-ui/index.html
```

加载方式：

```text
/plugin-web/{name}/ui/index.html
```

页面在 sandbox iframe 中运行。宿主加载后发送：

```js
window.parent.postMessage({
  type: 'cloudbox:init',
  token: '<短期 token>',
  user: { id, username, role },
}, '*');
```

插件页面必须监听 `message` 事件，校验 `type === 'cloudbox:init'` 后使用 `token` 和用户信息。

`web-override/index.html` 同样以 sandbox iframe 包装加载，不再直接替换主页面。只有管理员显式允许该插件接管 Web 时才生效。

## 13. 管理端设置页

- `admin-ui/index.html`：Electron 通过 `plugin-admin://{name}/index.html` 加载；Web 管理端通过受保护的 `/api/admin/plugins/{name}/admin/...` 加载。
- `manifest.adminUrl`：插件自行提供 HTTP/HTTPS 页面，插件卡片会打开系统浏览器。
- `admin-url` 页面需要自行鉴权。

## 14. 最小示例

```js
module.exports = async function activate(ctx) {
  ctx.logger.info('demo plugin started');

  await ctx.ui.registerComponent({
    id: 'demo',
    title: 'Demo',
    icon: 'sparkles',
    position: 'bottom-right',
  });

  await ctx.ai.registerTool(
    'echo',
    'Echo text',
    { type: 'object', properties: { text: { type: 'string' } } },
    async (args) => ({ echo: args.text }),
  );

  const stats = await ctx.system.getStats();
  ctx.logger.info('online users', stats.onlineUsers);
};
```

完整演示见 `plugins/web-button-demo/`。

## 15. 禁止能力

以下能力不会暴露给插件：

- 修改 WAF 策略
- 切换安全模式
- 手动封禁/解封
- 清除安全计数
- 读取其他插件私有存储
- 绕过 `safePath` 访问宿主文件

---

# English

## Runtime

Plugins run in a separate child process. The host forwards HTTP requests, events, logs and whitelisted capability RPCs. Plugins cannot mutate WAF policy, security mode, bans, or security counters.

## Activate

```js
module.exports = async function activate(ctx) {
  ctx.logger.info('started');
};
```

## Config, logs, scheduling

```js
ctx.config.get(key, fallback);
ctx.config.set(key, value);
ctx.logger.info('message');
ctx.schedule('*/5 * * * *', async () => {});
```

## Read-only system/security

```js
const stats = await ctx.system.getStats();
const bans = await ctx.security.getBannedList();
```

Only `security.getBannedList()` is exposed. No write API for WAF/security mode/bans/counters exists.

## Users

```js
await ctx.user.getInfo(userId);
await ctx.user.updateQuota(userId, bytes); // null = unlimited
await ctx.user.setMeta(userId, key, value);
await ctx.user.getMeta(userId, key);
```

Metadata keys are limited to letters/digits/dot/underscore/hyphen, max 64KB per value.

## Files

All paths use `safePath`.

```js
await ctx.file.read(userId, 'notes/a.txt');
await ctx.file.write(userId, 'notes/a.txt', 'hello');
await ctx.file.list(userId, 'notes');
await ctx.file.getUrl(userId, 'notes/a.txt');
```

`read/write` handle UTF-8 text only.

## AI

```js
await ctx.ai.registerTool(name, description, parametersSchema, handler);
ctx.ai.injectPrompt('Additional knowledge for the native AI assistant.');
```

Registered tools are exposed to the native AI assistant and executed through the plugin child process.

## Events

```js
ctx.on('file.uploaded', (payload) => {});
ctx.on('security.banned', (payload) => {});
```

## HTTP routes

```js
const router = ctx.createRouter();
router.get('/status', async () => ({ body: { ok: true } }));
ctx.registerRouter('', router);
```

Mounted at `/api/plugins/{manifest.name}{prefix}`. Authentication and CSRF apply.

## UI slots and iframe sandbox

```js
await ctx.ui.registerComponent({
  id: 'my-button',
  title: 'Open panel',
  icon: 'sparkles',
  position: 'bottom-right',
});
```

Place `web-ui/index.html`. It is loaded in a sandbox iframe and receives:

```js
{ type: 'cloudbox:init', token, user: { id, username, role } }
```

via `postMessage`. `web-override/index.html` is also wrapped in a sandbox iframe.

## Security boundary

Plugins cannot modify WAF policy, security mode, bans or counters; cannot read other plugins' storage; cannot bypass `safePath`.
