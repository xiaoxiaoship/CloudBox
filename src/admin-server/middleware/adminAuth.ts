import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { AdminAuthService } from '../../core/services/admin/adminAuthService.ts';
import type { AuditService } from '../../core/services/auditService.ts';
import type { PublicUser } from '../../core/types/models.ts';
import { readCookie } from '../../server/http/cookies.ts';
import { getRequestId } from '../../server/middleware/requestId.ts';

export const ADMIN_SESSION_COOKIE = 'admin_sid';
export const ADMIN_CSRF_COOKIE = 'admin_csrf';
export const ADMIN_CSRF_HEADER = 'x-csrf-token';

export function createAdminCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfMatches(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function setAdminCookies(
  req: Request,
  res: Response,
  token: string,
  csrfToken: string,
  maxAgeMs: number,
): void {
  const secure = req.secure;
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: Math.max(0, maxAgeMs),
  });
  res.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: Math.max(0, maxAgeMs),
  });
}

export function clearAdminCookies(req: Request, res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/', secure: req.secure });
  res.clearCookie(ADMIN_CSRF_COOKIE, { path: '/', secure: req.secure });
}

export function adminUser(res: Response): PublicUser {
  return res.locals.adminUser as PublicUser;
}

export function createRequireAdmin(auth: AdminAuthService): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req, ADMIN_SESSION_COOKIE);
    const validated = auth.validate(token, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: getRequestId(res),
    });
    if (validated === null) {
      const csrfToken = createAdminCsrfToken();
      res.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure: req.secure,
        path: '/',
      });
      res.status(401).json({ code: 'ADMIN_SESSION_INVALID', message: '管理员会话已失效，请重新登录' });
      return;
    }
    res.locals.adminUser = validated.user;
    res.locals.adminToken = token;
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createAdminCsrf(audit: AuditService): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const cookieToken = readCookie(req, ADMIN_CSRF_COOKIE);
    const headerToken = req.get(ADMIN_CSRF_HEADER);
    if (cookieToken && headerToken && csrfMatches(cookieToken, headerToken)) {
      next();
      return;
    }

    audit.record({
      actorType: 'admin',
      actorId: (res.locals.adminUser as PublicUser | undefined)?.id ?? null,
      action: 'security.admin.csrf.reject',
      result: 'denied',
      targetType: 'request',
      targetPath: req.originalUrl,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: getRequestId(res),
      detail: { method: req.method },
    });
    res.status(403).json({ code: 'ADMIN_CSRF_INVALID', message: '管理端 CSRF 校验失败' });
  };
}
