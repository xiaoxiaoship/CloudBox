import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import type { CoreServices } from '../../core/container.ts';

export function createAdminAppRouter(
  services: CoreServices,
  dataDir: string,
  csrf: RequestHandler,
): Router {
  const router = Router();

  router.get('/backup', csrf, async (_req, res) => {
    const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+$/, '');
    const fileName = `cloudbox-backup-${stamp}.db`;
    const temporary = path.join(dataDir, 'tmp', `backup-${randomUUID()}.db`);
    try {
      await services.db.backup(temporary);
      res.download(temporary, fileName, (error) => {
        void rm(temporary, { force: true }).catch(() => {});
        if (error && !res.headersSent) res.status(500).end();
      });
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      res.status(500).json({
        code: 'DATABASE_BACKUP_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
