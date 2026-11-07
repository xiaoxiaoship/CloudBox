import type { RequestHandler } from 'express';
import type { AuditService } from '../../core/services/auditService.ts';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  csrfTokensMatch,
  readCookie,
} from '../http/cookies.ts';
import { getRequestId } from './requestId.ts';

export class CsrfError extends Error {
  readonly code = 'CSRF_INVALID';
  readonly httpStatus = 403;

  constructor() {
    super('CSRF 校验失败，请刷新页面后重试');
    this.name = 'CsrfError';
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF：
 *  - 非安全方法必须同时携带 Cookie 与 X-CSRF-Token 头，且两者恒定时间相等
 *  - 失败写 denied 审计（含用户与请求 ID）
 *  - 与 Cookie SameSite=Lax 形成双保险
 */
export function createCsrfProtection(audit: AuditService): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerToken = req.get(CSRF_HEADER);

    if (cookieToken && headerToken && csrfTokensMatch(cookieToken, headerToken)) {
      next();
      return;
    }

    audit.record({
      actorType: req.user?.role === 'admin' ? 'admin' : 'user',
      actorId: req.user?.id ?? null,
      action: 'security.csrf.reject',
      result: 'denied',
      targetType: 'request',
      targetPath: req.originalUrl,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: getRequestId(res),
      detail: { method: req.method, hasCookie: cookieToken !== null, hasHeader: Boolean(headerToken) },
    });

    next(new CsrfError());
  };
}
