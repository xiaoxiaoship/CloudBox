# CloudBox Plugin API

插件运行在独立子进程中。`index.js` 导出 `activate(ctx)`（CommonJS）即可。

## 系统与只读安全

```js
ctx.config.get(key, fallback)
ctx.config.set(key, value)
ctx.schedule('*/5 * * * *', async () => {})
await ctx.system.getStats()
await ctx.security.getBannedList() // 只读，不能封禁/解封或修改 WAF
ctx.logger.info('hello')
```

## 用户

```js
await ctx.user.getInfo(userId)
await ctx.user.updateQuota(userId, bytes) // bytes=null 表示不限量
await ctx.user.getMeta(userId, key)
await ctx.user.setMeta(userId, key, value)
```

## 文件（均经过 safePath）

```js
await ctx.file.read(userId, 'notes/a.txt')
await ctx.file.write(userId, 'notes/a.txt', 'hello')
await ctx.file.list(userId, 'notes')
await ctx.file.getUrl(userId, 'notes/a.txt') // 1 小时内部直链
```

## AI

```js
await ctx.ai.registerTool('my_tool', '说明', schema, async (args) => result)
ctx.ai.injectPrompt('给原生 AI 的补充知识')
```

## 事件与 UI

```js
ctx.on('file.uploaded', (payload) => {})
ctx.on('security.banned', (payload) => {})
await ctx.ui.registerComponent({
  id: 'my-button',
  title: '我的按钮',
  icon: 'sparkles',
  position: 'bottom-right', // bottom-right | bottom-left | sidebar
})
```

带 `web-ui/index.html` 的插件，其 UI 会在 sandbox iframe 中加载；页面通过
`postMessage` 接收 `{ type: 'cloudbox:init', token, user }`。

禁止能力：修改安全模式、WAF 策略、封禁/解封、清除安全计数。宿主只向插件暴露
`security.getBannedList()`。

## 演示插件

`plugins/web-button-demo/` 注册“测试按钮”，点击后打开 sandbox iframe，并展示
宿主传入的用户信息和 token。
