import { Router, type RequestHandler } from 'express';
import path from 'node:path';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';

export function createAdminPluginsRouter(
  services: CoreServices,
  csrf: RequestHandler,
): Router {
  const router = Router();
  const nameOf = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : (value ?? '');

  router.get('/', (_req, res) => {
    res.json(services.plugins.list());
  });

  router.post('/:name/enabled', csrf, async (req, res) => {
    const input = z.object({ enabled: z.boolean() }).parse(req.body);
    await services.plugins.setEnabled(nameOf(req.params.name), input.enabled);
    res.json(services.plugins.list());
  });

  router.post('/:name/web-override', csrf, (req, res) => {
    const input = z.object({ allowed: z.boolean() }).parse(req.body);
    services.plugins.setAllowWebOverride(nameOf(req.params.name), input.allowed);
    res.json(services.plugins.list());
  });

  router.delete('/:name', csrf, async (req, res) => {
    const name = nameOf(req.params.name);
    await services.plugins.uninstall(name);
    res.json(services.plugins.list());
  });

  router.get('/:name/admin/*splat', (req, res) => {
    const name = nameOf(req.params.name);
    const splat = req.params.splat;
    const relative = Array.isArray(splat) ? splat.join('/') : (splat ?? 'index.html');
    const target = services.plugins.getAdminUiPath(name, relative);
    if (target === null) {
      res.status(404).json({ code: 'PLUGIN_ADMIN_NOT_FOUND', message: '插件管理页面不存在' });
      return;
    }
    res.sendFile(path.resolve(target));
  });

  return router;
}
