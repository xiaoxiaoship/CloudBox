import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import {
  GUEST_ERROR,
  GUEST_TOKEN_RE,
  GuestError,
} from '../../core/services/guestLinkService.ts';
import type { PolicyRule } from '../../core/services/securityPolicyService.ts';
import type { SessionUser } from '../../core/types/models.ts';
import { requestContext } from '../http/context.ts';
import { GUEST_COOKIE, readCookie } from '../http/cookies.ts';
import { sendDownload } from '../http/download.ts';

const linkBody = z.object({
  password: z.string().max(128).optional(),
});

const unlockBody = z.object({
  password: z.string().max(128).optional(),
});

const listQuery = z.object({
  path: z.string().max(900).optional().default(''),
});

const downloadQuery = z.object({
  path: z.string().min(1).max(900),
});

function tokenOf(req: Request): string {
  const raw = req.params.token;
  const token = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  if (!GUEST_TOKEN_RE.test(token)) {
    throw new GuestError(GUEST_ERROR.NOT_FOUND, '访客链接不存在', 404);
  }
  return token;
}

function absoluteUrl(services: CoreServices, req: Request, token: string, mode: 'auto' | 'public'): string {
  const origin = { protocol: req.protocol as 'http' | 'https', host: req.get('host') ?? '' };
  return services.hosting.absoluteUrl(`/guest/${token}`, origin, mode);
}

/** 访客链接管理接口（普通用户，需登录 + CSRF） */
export function createGuestRouter(
  services: CoreServices,
  deps: { csrf: RequestHandler },
): Router {
  const router = Router();

  router.get('/status', (req, res) => {
    const status = services.guestLinks.status(req.user!);
    res.json({
      enabled: status.enabled,
      link:
        status.link === null
          ? null
          : { ...status.link, url: absoluteUrl(services, req, status.link.token, services.settings.get('guest.addressMode')) },
    });
  });

  router.post('/link', deps.csrf, async (req, res) => {
    if (!services.guestLinks.isEnabled()) {
      throw new GuestError(GUEST_ERROR.DISABLED, '管理员已关闭访客模式', 403);
    }
    const body = linkBody.parse(req.body ?? {});
    const password = typeof body.password === 'string' && body.password !== '' ? body.password : null;
    const link = await services.guestLinks.create(req.user!, password);

    services.audit.record({
      actorType: req.user!.role === 'admin' ? 'admin' : 'user',
      actorId: req.user!.id,
      action: 'guest.link.create',
      result: 'success',
      targetType: 'guest_link',
      targetId: String(req.user!.id),
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: null,
      detail: { hasPassword: link.passwordHash !== null, expiresAt: link.expiresAt },
    });

    res.status(201).json({
      token: link.token,
      url: absoluteUrl(services, req, link.token, services.settings.get('guest.addressMode')),
      hasPassword: link.passwordHash !== null,
      expiresAt: link.expiresAt,
    });
  });

  router.delete('/link', deps.csrf, (req, res) => {
    const removed = services.guestLinks.revoke(req.user!.id);
    if (removed) {
      services.audit.record({
        actorType: req.user!.role === 'admin' ? 'admin' : 'user',
        actorId: req.user!.id,
        action: 'guest.link.revoke',
        result: 'success',
        targetType: 'guest_link',
        targetId: String(req.user!.id),
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: null,
      });
    }
    res.status(204).end();
  });

  return router;
}

export interface PublicGuestRouterDeps {
  guestLimiter: RequestHandler;
  downloadLimiter: RequestHandler;
}

/**
 * 访客公开接口：完全不经过 requireUser / 普通 session 中间件。
 * 只读：info / unlock / files / download；没有任何写入、分享、上传入口。
 */
export function createPublicGuestRouter(
  services: CoreServices,
  deps: PublicGuestRouterDeps,
): Router {
  const router = Router();

  /** IP 维度的访客密码失败计数（与用户登录计数隔离，成功解锁只清这里） */
  const failures = new Map<string, { windowStart: number; count: number }>();

  const enabled = (): void => {
    if (!services.guestLinks.isEnabled()) {
      throw new GuestError(GUEST_ERROR.DISABLED, '管理员已关闭访客模式', 403);
    }
  };

  const banMinutes = (rule: PolicyRule, escalation = 0): number => {
    if (String(rule.config.banMode ?? '') === 'variable') {
      const base = Math.max(1, Number(rule.config.baseMinutes ?? 1));
      const max = Math.max(base, Number(rule.config.maxMinutes ?? 60));
      return Math.min(max, base * 2 ** Math.max(0, escalation));
    }
    const raw =
      rule.config.banMinutes ??
      rule.config.fixedMinutes ??
      (rule.config.banHours === undefined ? undefined : Number(rule.config.banHours) * 60);
    return raw === undefined ? 10 : Number(raw);
  };

  const banInfo = (ip: string): { until: number; feature: string } | null => {
    const active = services.securityPolicy.activeBan('ip', ip);
    if (active === null) return null;
    const remaining = Math.max(1, Math.ceil((active.until - Date.now()) / 60_000));
    services.events.emit('security.limit', {
      category: '安全策略',
      scope: 'ip',
      target: ip,
      feature: active.feature,
      featureName: '访客密码错误限制',
      remainingMinutes: remaining,
      message: `IP 访客密码错误次数已触发限制，剩余 ${remaining} 分钟`,
    });
    return { until: active.until, feature: active.feature };
  };

  const rejectBanned = (ip: string): void => {
    const ban = banInfo(ip);
    if (ban === null) return;
    throw new GuestError(
      GUEST_ERROR.PASSWORD_INVALID,
      '访客密码错误次数过多，请稍后再试',
      403,
    );
  };

  /** 记录一次密码失败：持久计数 + 本地窗口计数 + 达阈值触发策略封禁 */
  const recordFailure = (ip: string): void => {
    services.securityPolicy.addCount('ip', ip, 'loginFailure', 1);

    const rule = services.securityPolicy.rule('loginFailure', 'ip');
    const windowMs = Math.max(1, Number(rule?.config.windowMinutes ?? 15)) * 60_000;
    const threshold = Math.max(1, Number(rule?.config.threshold ?? 5));
    const now = Date.now();
    const bucket = failures.get(ip);
    const current =
      bucket === undefined || now - bucket.windowStart >= windowMs
        ? { windowStart: now, count: 0 }
        : bucket;
    current.count += 1;
    failures.set(ip, current);

    if (current.count >= threshold) {
      failures.delete(ip);
      services.securityPolicy.ban(
        'ip',
        ip,
        'loginFailure',
        banMinutes(rule ?? { feature: 'loginFailure', scope: 'ip', config: {} }),
      );
    }
  };

  const guestSession = (req: Request, token: string, res: Response): SessionUser => {
    const raw = readCookie(req, GUEST_COOKIE);
    if (raw === null) {
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }
    const resolution = services.guestLinks.validateSession(raw);
    if (resolution.link.token !== token) {
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }
    // 每次只读请求顺延 cookie 的浏览器侧过期时间（服务端会话仍按固定 TTL 判定）
    const remaining = Math.max(0, resolution.session.expiresAt - Date.now());
    if (remaining > 0) {
      res.cookie(GUEST_COOKIE, raw, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: req.secure,
        maxAge: remaining,
      });
    }
    return resolution.owner;
  };

  router.get('/:token', deps.guestLimiter, (req, res) => {
    enabled();
    const info = services.guestLinks.info(tokenOf(req));
    res.json({
      ownerUsername: info.ownerUsername,
      hasPassword: info.hasPassword,
      expiresAt: info.expiresAt,
    });
  });

  router.post('/:token/unlock', deps.guestLimiter, async (req, res) => {
    enabled();
    const token = tokenOf(req);
    const ip = req.ip ?? 'unknown';
    rejectBanned(ip);

    const body = unlockBody.parse(req.body ?? {});
    const password = body.password ?? '';

    // 已经持有有效访客会话时直接复用，避免同一次浏览重复占用并发名额
    const existing = readCookie(req, GUEST_COOKIE);
    if (existing !== null) {
      try {
        const resolution = services.guestLinks.validateSession(existing);
        if (resolution.link.token === token) {
          failures.delete(ip);
          res.cookie(GUEST_COOKIE, existing, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secure: req.secure,
            maxAge: Math.max(0, resolution.session.expiresAt - Date.now()),
          });
          res.json({
            unlocked: true,
            expiresAt: resolution.session.expiresAt,
            ownerUsername: resolution.owner.username,
          });
          return;
        }
      } catch {
        // 无效会话按未解锁处理
      }
    }

    let result;
    try {
      result = await services.guestLinks.unlock(token, password);
    } catch (error) {
      if (error instanceof GuestError && error.code === GUEST_ERROR.PASSWORD_INVALID) {
        recordFailure(ip);
        rejectBanned(ip);
        res.status(429).json({
          code: GUEST_ERROR.PASSWORD_INVALID,
          message: '访问密码不正确，请稍后再试',
        });
        return;
      }
      throw error;
    }

    // 成功解锁：只清该 IP 的访客失败计数，不触碰用户登录失败计数
    failures.delete(ip);

    const globalRemaining = Math.max(0, result.expiresAt - Date.now());
    res.cookie(GUEST_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: req.secure,
      maxAge: globalRemaining,
    });

    res.json({
      unlocked: true,
      expiresAt: result.expiresAt,
      ownerUsername: result.owner.username,
    });
  });

  router.get('/:token/files', deps.guestLimiter, async (req, res) => {
    enabled();
    const token = tokenOf(req);
    const owner = guestSession(req, token, res);
    const query = listQuery.parse(req.query ?? {});
    const listing = await services.files.list(owner, query.path, requestContext(req, res));
    res.json(listing);
  });

  router.get('/:token/download', deps.downloadLimiter, async (req, res) => {
    enabled();
    const token = tokenOf(req);
    const owner = guestSession(req, token, res);
    const query = downloadQuery.parse(req.query ?? {});
    const target = await services.files.openDownload(
      owner,
      query.path,
      requestContext(req, res),
    );

    services.audit.record({
      actorType: 'anonymous',
      actorId: null,
      action: 'guest.download',
      result: 'success',
      targetType: 'guest_link',
      targetId: String(owner.id),
      targetPath: target.relativePath,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: null,
      detail: { size: target.size },
    });

    await sendDownload(req, res, target);
  });

  return router;
}
