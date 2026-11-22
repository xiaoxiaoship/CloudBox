import express, { Router, type RequestHandler } from 'express';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';

export function createAdminPluginsRouter(
  services: CoreServices,
  csrf: RequestHandler,
): Router {
  const router = Router();
  const nameOf = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : (value ?? '');

  router.post('/import', csrf, express.raw({ type: 'application/zip', limit: '21mb' }), async (req, res) => {
    const fileName = req.get('x-plugin-filename') ?? '';
    if (!/^[^/\\]+\.zip$/i.test(fileName) || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ code: 'INVALID_PLUGIN_PACKAGE', message: '请上传 ZIP 插件包' });
      return;
    }
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'cloudbox-plugin-'));
    const file = path.join(temporary, fileName);
    try {
      await writeFile(file, req.body);
      const result = await services.plugins.importZip(file);
      const user = res.locals.adminUser as { id: number };
      services.audit.record({ actorType: 'admin', actorId: user.id, action: 'plugin.import', result: 'success', targetType: 'plugin', detail: { fileName } });
      res.json(result);
    } catch (error) {
      res.status(400).json({ code: 'PLUGIN_IMPORT_FAILED', message: error instanceof Error ? error.message : String(error) });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

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
