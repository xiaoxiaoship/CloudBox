import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { requestContext } from '../http/context.ts';
import { sendDownload } from '../http/download.ts';

const createShareSchema = z.object({
  file_path: z.string().min(1).max(900),
  duration_seconds: z.number().int().min(30).max(7_200),
});

export interface SharesRouterDeps {
  csrf: RequestHandler;
  shareLimiter: RequestHandler;
}

export function createSharesRouter(services: CoreServices, deps: SharesRouterDeps): Router {
  const router = Router();

  router.post('/', deps.shareLimiter, deps.csrf, async (req, res) => {
    const body = createShareSchema.parse(req.body);
    const created = await services.shares.create(
      req.user!,
      body.file_path,
      body.duration_seconds,
      requestContext(req, res),
    );

    const host = req.get('host');
    const path = `/api/public/s/${created.token}`;
    const url = host ? `${req.protocol}://${host}${path}` : path;

    res.status(201).json({
      token: created.token,
      path,
      url,
      file_path: created.filePath,
      expires_at: created.expiresAt,
    });
  });

  return router;
}

export interface PublicSharesRouterDeps {
  shareDownloadLimiter: RequestHandler;
}

export function createPublicSharesRouter(
  services: CoreServices,
  deps: PublicSharesRouterDeps,
): Router {
  const router = Router();

  router.get('/:token', deps.shareDownloadLimiter, async (req, res) => {
    const rawToken = req.params.token;
    const token = Array.isArray(rawToken) ? (rawToken[0] ?? '') : (rawToken ?? '');
    const target = await services.shares.resolveDownload(token, requestContext(req, res));
    await sendDownload(req, res, target);
  });

  return router;
}
