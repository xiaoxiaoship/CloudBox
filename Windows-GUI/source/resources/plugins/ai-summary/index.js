/**
 * 示例插件：外部 AI 摘要。
 *
 * 配置方式（ctx.storage）：
 *   storage.set('apiKey', '...');
 *   storage.set('endpoint', 'https://api.openai.com/v1/chat/completions');
 *   storage.set('model', 'gpt-4o-mini');
 *
 * 若不配置 apiKey，则返回演示结果，便于本地验证插件路由和 iframe。
 */
module.exports = async function activate(ctx) {
  const router = ctx.createRouter();

  router.post('/generate', async (req) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return { status: 400, body: { code: 'EMPTY_TEXT', message: 'text 不能为空' } };
    }

    const apiKey = ctx.storage.get('apiKey', process.env.OPENAI_API_KEY ?? '');
    const endpoint = ctx.storage.get(
      'endpoint',
      'https://api.openai.com/v1/chat/completions',
    );
    const model = ctx.storage.get('model', 'gpt-4o-mini');

    if (!apiKey) {
      ctx.logger.warn('未配置 API Key，返回演示摘要');
      return {
        status: 200,
        body: {
          demo: true,
          summary: text.length > 80 ? `${text.slice(0, 80)}…` : text,
          model: 'demo',
        },
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '请用简洁的中文总结用户提供的文本，不超过 120 字。',
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      ctx.logger.error('AI API 请求失败', response.status, detail.slice(0, 500));
      return {
        status: 502,
        body: { code: 'AI_API_ERROR', message: `AI API 返回 HTTP ${response.status}` },
      };
    }

    const data = await response.json();
    return {
      status: 200,
      body: {
        summary: data.choices?.[0]?.message?.content ?? '',
        model,
      },
    };
  });

  // 挂载为 /api/plugins/ai-summary/generate
  ctx.registerRouter('', router);
  ctx.on('file.uploaded', (payload) => {
    ctx.logger.info('收到 file.uploaded 事件', payload.path);
  });
};
