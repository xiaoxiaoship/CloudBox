import { readFile } from 'node:fs/promises';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { SESSION_COOKIE, readCookie } from '../http/cookies.ts';
import { requestContext } from '../http/context.ts';

const deployBody = z.object({
  rootPath: z.string().min(1).max(900),
  enabled: z.boolean(),
  visibility: z.enum(['public', 'private']),
});

const HOST_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "sandbox allow-scripts allow-forms allow-popups",
].join('; ');

export function createHostingApiRouter(
  services: CoreServices,
  deps: { csrf: RequestHandler },
): Router {
  const router = Router();
  router.get('/settings', (req, res) => {
    if (!services.settings.get('hosting.enabled')) {
      res.status(403).json({ code: 'HOSTING_DISABLED', message: '管理员尚未开启静态托管' });
      return;
    }
    res.json(services.hosting.get(req.user!));
  });
  router.put('/settings', deps.csrf, async (req, res) => {
    const body = deployBody.parse(req.body);
    const result = await services.hosting.save(req.user!, body, requestContext(req, res));
    res.json(result);
  });
  router.post('/disable', deps.csrf, (req, res) => {
    res.json(services.hosting.disable(req.user!));
  });
  return router;
}

export function createHostingSiteRouter(services: CoreServices): Router {
  const router = Router();

  const deliver = async (
    req: import('express').Request,
    res: import('express').Response,
    username: string,
    relative: string,
  ): Promise<void> => {
    let viewer = null;
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      try {
        viewer = services.auth.validateSession(token).user;
      } catch {
        viewer = null;
      }
    }

    const resolved = services.hosting.resolveRequest(username, relative, viewer);
    if (resolved === null) {
      res.status(403).json({ code: 'HOSTING_FORBIDDEN', message: '站点不存在或无权访问' });
      return;
    }
    try {
      const content = await readFile(resolved.absolutePath);
      res.type(resolved.mimeHint || 'bin');
      res.setHeader('Content-Security-Policy', HOST_CSP);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).send(content);
    } catch {
      res.status(404).json({ code: 'HOSTING_NOT_FOUND', message: '静态资源不存在' });
    }
  };

  router.get('/:username', (req, res) => {
    void deliver(req, res, req.params.username ?? '', '');
  });
  router.get('/:username/*splat', (req, res) => {
    const splat = req.params.splat;
    const relative = Array.isArray(splat) ? splat.join('/') : (splat ?? '');
    void deliver(req, res, req.params.username ?? '', relative);
  });

  return router;
}
