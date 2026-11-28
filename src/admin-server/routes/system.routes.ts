import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { clearLimitedIp, listLimitedIps } from '../../server/middleware/rateLimit.ts';
import { clearAdminLogs, getAdminLogView } from '../../core/services/admin/adminLogService.ts';
import type { UpdateManager } from '../../core/services/updateManager.ts';

const countKey = z.object({
  scope: z.enum(['ip', 'account', 'global']),
  target: z.string().min(1).max(500),
  feature: z.string().min(1).max(100),
});

export function createAdminSystemRouter(
  services: CoreServices,
  version: string,
  csrf: RequestHandler,
  updateManager?: UpdateManager,
): Router {
  const router = Router();

  router.get('/rate-limits', (_req, res) => {
    res.json(listLimitedIps());
  });

  router.post('/rate-limits/clear', csrf, (req, res) => {
    const input = z.object({ ip: z.string().min(1) }).parse(req.body);
    clearLimitedIp(input.ip);
    res.json({ cleared: input.ip });
  });

  router.get('/security-bans', (_req, res) => {
    res.json(services.securityPolicy.listActive());
  });

  router.post('/security-bans/:id/clear', csrf, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ code: 'INVALID_INPUT', message: '封禁 ID 不合法' });
      return;
    }
    services.securityPolicy.clear(id);
    res.status(204).end();
  });

  router.post('/security-bans/clear-all', csrf, (_req, res) => {
    res.json({ removed: services.securityPolicy.clearAll() });
  });

  router.get('/security-counts', (_req, res) => {
    res.json(services.securityPolicy.listCounts());
  });

  router.post('/security-counts/clear', csrf, (req, res) => {
    const input = countKey.parse(req.body);
    services.securityPolicy.clearCount(input.scope, input.target, input.feature);
    res.status(204).end();
  });

  router.post('/security-counts/clear-all', csrf, (_req, res) => {
    services.securityPolicy.clearAllCounts();
    res.status(204).end();
  });

  router.get('/check-update', async (_req, res) => {
    res.json(updateManager ? await updateManager.check() : await services.update.check(version, 'server'));
  });

  router.get('/update/status', (_req, res) => {
    if (updateManager === undefined) {
      res.status(501).json({ code: 'UPDATE_NOT_AVAILABLE', message: '自动更新未启用' });
      return;
    }
    res.json(updateManager.status());
  });

  router.post('/update/download', csrf, (_req, res) => {
    if (updateManager === undefined) {
      res.status(501).json({ code: 'UPDATE_NOT_AVAILABLE', message: '自动更新未启用' });
      return;
    }
    void updateManager.download().catch(() => { /* status exposes the error */ });
    res.status(202).json(updateManager.status());
  });

  router.post('/update/install', csrf, (_req, res) => {
    if (updateManager === undefined) {
      res.status(501).json({ code: 'UPDATE_NOT_AVAILABLE', message: '自动更新未启用' });
      return;
    }
    void updateManager.install().catch(() => { /* status exposes the error */ });
    res.status(202).json(updateManager.status());
  });

  router.get('/task-usage', (_req, res) => {
    res.json({ ...services.tasks.featureUsage(), overall: services.tasks.stats() });
  });

  router.get('/logs/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="cloudbox-logs.json"');
    res.json({ exportedAt: new Date().toISOString(), ...getAdminLogView(services.audit, 500) });
  });

  router.post('/logs/clear', csrf, (_req, res) => {
    const actor = res.locals.adminUser as { id?: number } | undefined;
    clearAdminLogs(services.audit);
    services.audit.record({ actorType: 'admin', actorId: actor?.id ?? null, action: 'logs.clear', result: 'success', targetType: 'logs' });
    res.json({ ok: true });
  });

  router.get('/logs', (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
    res.json(getAdminLogView(services.audit, limit));
  });

  return router;
}
