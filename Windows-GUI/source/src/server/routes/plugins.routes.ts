import type { RequestHandler } from 'express';
import { Router } from 'express';
import path from 'node:path';
import type { CoreServices } from '../../core/container.ts';
import { requestContext } from '../http/context.ts';

export function createPluginsRouter(
  services: CoreServices,
  deps: { csrf: RequestHandler },
): Router {
  const router = Router();

  router.get('/previewers', (_req, res) => {
    res.json(services.plugins.previewers());
  });

  router.use('/:name', deps.csrf, async (req, res) => {
    const name = Array.isArray(req.params.name) ? req.params.name[0] ?? '' : (req.params.name ?? '');
    const prefix = `/api/plugins/${name}`;
    const original = req.originalUrl.split('?')[0] ?? '';
    const relative = original.startsWith(prefix) ? original.slice(prefix.length) : req.path;
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') query[key] = value;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && key !== 'cookie' && key !== 'authorization') {
        headers[key] = value;
      }
    }

    let fileContent: string | undefined;
    if (relative === '/preview' && typeof query.path === 'string') {
      const extension = path.extname(query.path).toLowerCase();
      if (services.plugins.previewers()[extension] !== name) {
        res.status(404).json({ code: 'PREVIEWER_NOT_FOUND', message: '插件未声明预览此类型' });
        return;
      }
      try {
        fileContent = (await services.files.readText(
          req.user!,
          query.path,
          requestContext(req, res),
        )).content;
      } catch (error) {
        res.status(400).json({
          code: 'PREVIEW_READ_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    try {
      const response = await services.plugins.proxy(name, {
        method: req.method,
        path: relative === '' ? '/' : relative,
        query,
        headers,
        body: req.body ?? null,
        user: req.user
          ? { id: req.user.id, username: req.user.username, role: req.user.role }
          : null,
        ...(fileContent === undefined ? {} : { fileContent }),
      });
      if (response === null) {
        res.status(404).json({ code: 'PLUGIN_NOT_RUNNING', message: '插件未启用或未运行' });
        return;
      }
      if (typeof response.body === 'string') {
        res.status(response.status).set(response.headers).send(response.body);
      } else {
        res.status(response.status).set(response.headers).json(response.body);
      }
    } catch (error) {
      res.status(502).json({
        code: 'PLUGIN_PROXY_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
