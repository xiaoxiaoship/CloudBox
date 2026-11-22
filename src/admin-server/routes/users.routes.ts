import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AdminUserService } from '../../core/services/admin/adminUserService.ts';
import { AdminError } from '../../core/services/admin/adminUserService.ts';
import type { PublicUser } from '../../core/types/models.ts';
import { getRequestId } from '../../server/middleware/requestId.ts';

const idSchema = z.object({ userId: z.number().int().positive() });
const createSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
  quotaBytes: z.number().int().min(0).max(1024 ** 5).nullable(),
});
const quotaSchema = z.object({
  userId: z.number().int().positive(),
  quotaBytes: z.number().int().min(0).max(1024 ** 5).nullable(),
});
const resetSchema = z.object({
  userId: z.number().int().positive(),
  newPassword: z.string().min(8).max(128),
});
const statusSchema = z.object({
  userId: z.number().int().positive(),
  status: z.enum(['active', 'disabled']),
});
const securityModeSchema = z.object({
  userId: z.number().int().positive(),
  enabled: z.boolean(),
});
const removeSchema = z.object({
  userId: z.number().int().positive(),
  deleteFiles: z.boolean(),
});

function actor(res: Response): { id: number; username: string } {
  const user = res.locals.adminUser as PublicUser;
  return { id: user.id, username: user.username };
}

function failure(error: unknown, res: Response): void {
  if (error instanceof AdminError) {
    const status = error.code === 'USER_NOT_FOUND' ? 404
      : error.code === 'USERNAME_TAKEN' ? 409
        : error.code === 'ADMIN_EXISTS' ? 409 : 400;
    res.status(status).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ code: 'INVALID_INPUT', message: error.issues[0]?.message ?? '参数不合法' });
    return;
  }
  res.status(500).json({
    code: 'ADMIN_USER_OPERATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    requestId: getRequestId(res),
  });
}

export function createAdminUsersRouter(
  adminUsers: AdminUserService,
  csrf: RequestHandler,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(adminUsers.list());
  });

  router.patch('/me', csrf, (req, res) => {
    try {
      const input = z.object({ username: z.string().min(1).max(64) }).parse(req.body);
      res.json(adminUsers.renameSelf(actor(res), input.username));
    } catch (error) { failure(error, res); }
  });

  router.post('/', csrf, async (req, res) => {
    try {
      const input = createSchema.parse(req.body);
      res.status(201).json(await adminUsers.createUser(input, actor(res)));
    } catch (error) { failure(error, res); }
  });

  router.patch('/:userId/quota', csrf, (req, res) => {
    try {
      const input = quotaSchema.parse({ ...req.body, userId: Number(req.params.userId) });
      adminUsers.setQuota(input.userId, input.quotaBytes, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  router.post('/:userId/reset-password', csrf, async (req, res) => {
    try {
      const input = resetSchema.parse({ ...req.body, userId: Number(req.params.userId) });
      await adminUsers.resetPassword(input.userId, input.newPassword, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  router.post('/:userId/unlock', csrf, (req, res) => {
    try {
      const input = idSchema.parse({ userId: Number(req.params.userId) });
      adminUsers.unlockUser(input.userId, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  router.patch('/:userId/status', csrf, (req, res) => {
    try {
      const input = statusSchema.parse({ ...req.body, userId: Number(req.params.userId) });
      adminUsers.setStatus(input.userId, input.status, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  router.patch('/:userId/security-mode', csrf, (req, res) => {
    try {
      const input = securityModeSchema.parse({ ...req.body, userId: Number(req.params.userId) });
      adminUsers.setSecurityMode(input.userId, input.enabled, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  router.post('/:userId/clear-rename', csrf, (req, res) => {
    try {
      const input = idSchema.parse({ userId: Number(req.params.userId) });
      adminUsers.clearRenameLimit(input.userId, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  router.get('/:userId/ip-history', (req, res) => {
    try {
      const input = idSchema.parse({ userId: Number(req.params.userId) });
      res.json(adminUsers.ipHistory(input.userId));
    } catch (error) { failure(error, res); }
  });

  router.delete('/:userId', csrf, async (req, res) => {
    try {
      const input = removeSchema.parse({ ...req.body, userId: Number(req.params.userId) });
      await adminUsers.remove(input.userId, input.deleteFiles, actor(res));
      res.status(204).end();
    } catch (error) { failure(error, res); }
  });

  return router;
}
