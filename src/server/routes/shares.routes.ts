import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import type { CapService } from '../cap/capService.ts';
import type { SecurityPolicyService } from '../../core/services/securityPolicyService.ts';
import { requestContext } from '../http/context.ts';
import { requestOrigin } from '../http/origin.ts';
import { sendDownload } from '../http/download.ts';

const createShareSchema = z.object({
  file_path: z.string().min(1).max(900),
  duration_seconds: z.number().int().min(30).max(7_200),
});

export interface SharesRouterDeps {
  csrf: RequestHandler;
  shareLimiter: RequestHandler;
  cap: CapService;
  policy: SecurityPolicyService;
}

export function createSharesRouter(services: CoreServices, deps: SharesRouterDeps): Router {
  const router = Router();

  router.get('/', deps.shareLimiter, (req, res) => {
    const origin = requestOrigin(req);
    const mode = services.settings.get('share.addressMode');
    const now = Date.now();
    res.json(services.shares.list(req.user!).map((share) => {
      const path = `/api/public/s/${share.token}`;
      return {
        id: share.id,
        token: share.token,
        path,
        url: services.hosting.absoluteUrl(path, origin, mode),
        file_path: share.filePath,
        expires_at: share.expiresAt,
        created_at: share.createdAt,
        expired: now > share.expiresAt,
      };
    }));
  });

  router.delete('/:id', deps.shareLimiter, deps.csrf, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ code: 'INVALID_SHARE_ID', message: '分享记录 ID 不合法' }); return; }
    if (!services.shares.revoke(req.user!, id, requestContext(req, res))) {
      res.status(404).json({ code: 'SHARE_NOT_FOUND', message: '分享记录不存在' });
      return;
    }
    res.status(204).end();
  });

  router.post('/', deps.shareLimiter, deps.csrf, async (req, res) => {
    if (!services.settings.get('allow_user_direct_share')) {
      res.status(403).json({ code: 'FEATURE_DISABLED', message: '管理员已关闭直链分享' });
      return;
    }
    const body = createShareSchema.parse(req.body);
    const shareMaxSeconds = services.settings.getLowLevel().shareMaxSeconds;
    if (body.duration_seconds > shareMaxSeconds) {
      res.status(400).json({ code: 'SHARE_DURATION_TOO_LONG', message: `分享有效期不能超过 ${shareMaxSeconds} 秒` });
      return;
    }
    if (req.secure && deps.cap.enabled() && deps.policy.rule('cap', 'ip') !== null && !deps.cap.hasValidToken(req)) {
      const capRule = deps.policy.rule('cap', 'ip');
      const limit = capRule !== null ? Number(capRule.config.threshold ?? 10) : deps.cap.shareLimit();
      const since = Date.now() - 60_000;
      const recent = services.audit
        .list({ limit: 500 })
        .filter((entry) => entry.action === 'share.create' && entry.ip === req.ip && entry.ts >= since);
      if (recent.length >= limit) {
        res.status(403).json(deps.cap.requireResponse());
        return;
      }
    }
    const created = await services.shares.create(
      req.user!,
      body.file_path,
      body.duration_seconds,
      requestContext(req, res),
    );

    // 与静态托管共用地址解析：public 模式优先公网固定地址，否则用当前请求协议 + Host。
    const path = `/api/public/s/${created.token}`;
    const url = services.hosting.absoluteUrl(path, requestOrigin(req));

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
