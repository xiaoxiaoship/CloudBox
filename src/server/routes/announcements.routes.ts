import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';

export function createAnnouncementsRouter(services: CoreServices, deps: { csrf: RequestHandler }): Router {
  const router = Router();
  router.get('/', (req, res) => {
    res.json(services.announcements.listForUser(req.user!.id));
  });
  router.post('/read', deps.csrf, (req, res) => {
    z.object({ id: z.number().int().positive().optional() }).parse(req.body ?? {});
    services.announcements.markAllRead(req.user!.id);
    res.status(204).end();
  });
  return router;
}

const createSchema = z.object({
  category: z.enum(['critical', 'warning', 'info']),
  audience: z.enum(['all', 'user']),
  targetUserId: z.number().int().positive().nullable().optional(),
  body: z.string().min(1).max(5_000),
});

export function createAdminAnnouncementsRouter(services: CoreServices): Router {
  const router = Router();
  router.get('/', (_req, res) => { res.json(services.announcements.listAll()); });
  router.post('/', (req, res) => {
    const body = createSchema.parse(req.body);
    res.status(201).json(services.announcements.create(req.user!.id, body));
  });
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ code: 'INVALID_ANNOUNCEMENT_ID', message: '公告 ID 不合法' }); return; }
    if (!services.announcements.delete(id)) { res.status(404).json({ code: 'ANNOUNCEMENT_NOT_FOUND', message: '公告不存在' }); return; }
    res.status(204).end();
  });
  return router;
}
