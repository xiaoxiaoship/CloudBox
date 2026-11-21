import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AdminServerService } from '../../core/services/admin/adminServerService.ts';
import type { PublicUser } from '../../core/types/models.ts';
import { getRequestId } from '../../server/middleware/requestId.ts';

function actor(res: Response): PublicUser {
  return res.locals.adminUser as PublicUser;
}

export function createAdminServerRouter(
  server: AdminServerService,
  csrf: RequestHandler,
): Router {
  const router = Router();
  const status = () => server.status();

  router.get('/status', (_req, res) => {
    res.json(status());
  });

  router.post('/online', csrf, async (req, res) => {
    try {
      const input = z.object({ enabled: z.boolean() }).parse(req.body);
      actor(res);
      res.json(await server.setOnline(input.enabled));
    } catch (error) {
      res.status(400).json({
        code: 'SERVER_CONTROL_FAILED',
        message: error instanceof Error ? error.message : String(error),
        requestId: getRequestId(res),
      });
    }
  });

  router.post('/port', csrf, async (req, res) => {
    try {
      const input = z.object({ port: z.number().int().min(1024).max(65_535) }).parse(req.body);
      actor(res);
      res.json(await server.setPort(input.port));
    } catch (error) {
      res.status(400).json({
        code: 'SERVER_PORT_FAILED',
        message: error instanceof Error ? error.message : String(error),
        requestId: getRequestId(res),
      });
    }
  });

  router.post('/network', csrf, async (req, res) => {
    try {
      const input = z.object({
        protocol: z.enum(['http', 'https']),
        port: z.number().int().min(1024).max(65_535),
        mtlsEnabled: z.boolean().optional(),
      }).parse(req.body);
      actor(res);
      res.json(await server.applyNetwork(input));
    } catch (error) {
      res.status(400).json({
        code: 'SERVER_NETWORK_FAILED',
        message: error instanceof Error ? error.message : String(error),
        requestId: getRequestId(res),
      });
    }
  });

  router.post('/auto-start', csrf, (req, res) => {
    try {
      const input = z.object({ enabled: z.boolean() }).parse(req.body);
      actor(res);
      res.json(server.setAutoStart(input.enabled));
    } catch (error) {
      res.status(400).json({ code: 'INVALID_INPUT', message: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
