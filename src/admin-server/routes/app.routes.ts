import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import type { AdminDirectoryService } from '../../core/services/admin/adminDirectoryService.ts';

export function createAdminAppRouter(
  services: CoreServices,
  dataDir: string,
  directory: AdminDirectoryService,
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

  router.get('/directory', (_req, res) => {
    res.json(directory.current());
  });

  router.post('/directory', csrf, async (req, res) => {
    try {
      const input = z.object({
        kind: z.enum(['data', 'storage', 'plugins']),
        targetPath: z.string().min(1).max(500),
        migrate: z.boolean(),
        deleteOld: z.boolean().default(false),
      }).parse(req.body);
      const actor = res.locals.adminUser as { id: number };
      res.json(await directory.change(input, actor));
    } catch (error) {
      res.status(400).json({ code: 'DIRECTORY_CHANGE_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
