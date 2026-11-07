import { Router } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { requestContext } from '../http/context.ts';

const chatBody = z.object({
  locale: z.string().max(20).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(50_000),
      }),
    )
    .min(1)
    .max(40),
});

const settingsBody = z.object({
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(2000).optional(),
  dailyLimit: z.number().int().min(1).max(10_000).optional(),
  workScope: z.enum(['folder', 'all']).optional(),
  workDir: z.string().max(500).optional(),
});

export function createAiRouter(services: CoreServices, deps: { csrf: import('express').RequestHandler }): Router {
  const router = Router();

  router.get('/settings', (req, res) => {
    if (!services.settings.get('ai.enabled')) {
      res.status(403).json({ code: 'AI_DISABLED', message: 'AI 服务未开启' });
      return;
    }
    res.json(services.ai.publicSettings(req.user!));
  });

  router.put('/settings', deps.csrf, (req, res) => {
    const body = settingsBody.parse(req.body);
    res.json(services.ai.saveUserSettings(req.user!, body));
  });

  router.post('/chat', deps.csrf, async (req, res) => {
    if (!services.settings.get('ai.enabled')) {
      res.status(403).json({ code: 'AI_DISABLED', message: 'AI 服务未开启' });
      return;
    }
    const body = chatBody.parse(req.body);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ctx = requestContext(req, res);
    try {
      for await (const event of services.ai.chat(req.user!, body.messages, ctx, body.locale)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })}\n\n`,
      );
    } finally {
      res.end();
    }
  });

  router.post('/actions/:actionId/confirm', deps.csrf, async (req, res) => {
    const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] ?? '' : (req.params.actionId ?? '');
    const result = await services.ai.confirm(req.user!, actionId, requestContext(req, res));
    res.json(result);
  });

  return router;
}
