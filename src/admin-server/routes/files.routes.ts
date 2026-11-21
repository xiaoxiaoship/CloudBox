import { Router } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import type { SessionUser } from '../../core/types/models.ts';
import { toSessionUser } from '../../core/types/models.ts';
import { sendDownload } from '../../server/http/download.ts';
import { requestContext } from '../../server/http/context.ts';

const querySchema = z.object({
  userId: z.coerce.number().int().positive(),
  path: z.string().max(900).default(''),
});

function resolveUser(services: CoreServices, userId: number): SessionUser {
  const user = services.users.findById(userId);
  if (user === null) throw new Error('用户不存在');
  return toSessionUser(user);
}

export function createAdminFilesRouter(services: CoreServices): Router {
  const router = Router();

  router.get('/list', async (req, res) => {
    const input = querySchema.parse(req.query);
    const listing = await services.files.list(
      resolveUser(services, input.userId),
      input.path,
      requestContext(req, res),
    );
    res.json(listing);
  });

  router.get('/download', async (req, res) => {
    const input = querySchema.parse(req.query);
    const target = await services.files.openDownload(
      resolveUser(services, input.userId),
      input.path,
      requestContext(req, res),
    );
    await sendDownload(req, res, target);
  });

  return router;
}
