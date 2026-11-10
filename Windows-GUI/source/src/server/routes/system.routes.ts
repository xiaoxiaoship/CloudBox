import { Router } from 'express';
import type { CoreServices } from '../../core/container.ts';

export function createSystemRouter(
  services: CoreServices,
  deps: { version: string },
): Router {
  const router = Router();

  router.get('/check-update', async (req, res) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ code: 'FORBIDDEN', message: '仅管理员可以检查更新' });
      return;
    }
    res.json(await services.update.check(deps.version));
  });

  return router;
}
