/**
 * CloudBox 演示插件。
 * ctx 运行在独立子进程中，不能直接访问安全策略写接口。
 */
module.exports = async function activate(ctx) {
  ctx.logger.info('web-button-demo activated');

  await ctx.ui.registerComponent({
    id: 'test-button',
    title: '测试按钮',
    icon: 'sparkles',
    position: 'bottom-right',
  });

  ctx.config.set('installedAt', new Date().toISOString());

  // 演示只读系统/安全能力。
  const stats = await ctx.system.getStats().catch(() => null);
  if (stats) ctx.logger.info('system stats', stats.onlineUsers);
  await ctx.security.getBannedList().then((bans) => {
    ctx.logger.info('active bans', Array.isArray(bans) ? bans.length : 0);
  }).catch(() => {});

  await ctx.ai.registerTool(
    'demo_echo',
    '回显演示插件收到的文本。',
    { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async (args) => ({ echo: String(args.text ?? '') }),
  );
  ctx.ai.injectPrompt('当用户询问 CloudBox 演示插件时，说明它由 web-button-demo 提供。');
};
