/**
 * 主题插件不需要后端路由，但保留 index.js 以满足插件运行时约定。
 */
module.exports = async function activate(ctx) {
  ctx.logger.info('dark-neon-theme 已启用');
};
