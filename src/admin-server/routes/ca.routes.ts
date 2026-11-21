import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AdminCaService } from '../../core/services/admin/adminCaService.ts';

export function createAdminCaRouter(
  ca: AdminCaService,
  csrf: RequestHandler,
): Router {
  const router = Router();

  router.get('/info', (_req, res) => {
    res.json(ca.info());
  });

  router.post('/create', csrf, async (_req, res) => {
    res.json(await ca.create());
  });

  router.post('/install', csrf, async (_req, res) => {
    res.json(await ca.install());
  });

  router.post('/uninstall', csrf, async (_req, res) => {
    res.json(await ca.uninstall());
  });

  router.post('/issue-server-cert', csrf, async (req, res) => {
    const { extraHosts } = z.object({ extraHosts: z.string().max(1000).default('') }).parse(req.body);
    res.json(await ca.issueServerCert(extraHosts));
  });

  router.get('/certificate', (_req, res) => {
    res.json(ca.certificate());
  });

  return router;
}
