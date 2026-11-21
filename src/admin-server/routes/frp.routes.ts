import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AdminFrpService } from '../../core/services/admin/adminFrpService.ts';
import type { FrpConfig } from '../../shared/ipcTypes.ts';

const frpConfig = z.object({
  serverAddr: z.string().max(255),
  serverPort: z.number().int().min(1).max(65_535),
  remotePort: z.number().int().min(0).max(65_535),
  token: z.string().max(255),
  user: z.string().max(255),
  proxyName: z.string().max(64),
  tunnelType: z.enum(['tcp', 'http', 'https']),
  customDomain: z.string().max(253),
  proxyProtocol: z.boolean(),
  healthCheckMux: z.boolean(),
});

export function createAdminFrpRouter(
  frp: AdminFrpService,
  csrf: RequestHandler,
): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json(frp.status());
  });

  router.post('/config', csrf, async (req, res) => {
    const input = frpConfig.parse(req.body) as FrpConfig;
    res.json(await frp.saveConfig(input));
  });

  router.post('/start', csrf, async (_req, res) => {
    res.json(await frp.start());
  });

  router.post('/stop', csrf, async (_req, res) => {
    res.json(await frp.stop());
  });

  router.post('/restart', csrf, async (_req, res) => {
    res.json(await frp.restart());
  });

  router.get('/sync', (_req, res) => {
    res.json(frp.getSync());
  });

  router.post('/sync', csrf, (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    res.json(frp.setSync(enabled));
  });

  return router;
}
