import { Router, type Request, type RequestHandler, type Response as ExpressResponse } from 'express';
import { z } from 'zod';
import type { AdminCaService } from '../../core/services/admin/adminCaService.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

  router.post('/import', csrf, async (req, res) => {
    const input = z.object({
      kind: z.enum(['cert', 'key']),
      fileName: z.string().min(1).max(255),
      content: z.string().min(1).max(1_500_000),
    }).parse(req.body);
    res.json(await ca.importCertificate(input.kind, input.fileName, input.content));
  });

  router.post('/client-cert', csrf, async (_req: Request, res: ExpressResponse) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'cloudbox-client-export-'));
    const file = path.join(temporary, 'cloudbox-client.p12');
    try {
      await ca.exportClientCert(file);
      res.download(file, 'cloudbox-client.p12', () => {
        void rm(temporary, { recursive: true, force: true });
      });
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  });

  router.get('/certificate', (_req, res) => {
    res.json(ca.certificate());
  });

  return router;
}
