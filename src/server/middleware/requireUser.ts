import type { RequestHandler } from 'express';
import { AUTH_ERROR, AuthError, type AuthService } from '../../core/services/authService.ts';
import type { SecurityPolicyService } from '../../core/services/securityPolicyService.ts';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  generateCsrfToken,
  readCookie,
} from '../http/cookies.ts';

/**
 * 会话中间件：
 *  - 从 HttpOnly Cookie 读取原始 token，交给 AuthService 校验（哈希比对 + 过期/吊销检查）
 *  - 注入 req.user（不含 passwordHash）
 *  - 若浏览器缺少 CSRF Cookie，则补发一个（/me 会把它回传给前端）
 */
export function createRequireUser(auth: AuthService, policy?: SecurityPolicyService, isAdvanced: () => boolean = () => true): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      next(new AuthError(AUTH_ERROR.SESSION_INVALID, '请先登录', 401));
      return;
    }

    try {
      const session = auth.validateSession(token);
      req.user = session.user;

      const advancedMode = isAdvanced();
      const accountDenied = advancedMode && (policy?.isDenied('account', String(session.user.id)) || policy?.isDenied('account', session.user.username));
      const accountAllowed = policy?.isAllowed('account', String(session.user.id)) || policy?.isAllowed('account', session.user.username);
      if (accountDenied) {
        res.status(403).json({ code: 'SECURITY_BANNED', action: 'security_banned', message: '账户在黑名单中' });
        return;
      }
      if (advancedMode && !accountAllowed && policy?.activeBan('account', String(session.user.id))?.feature === 'global') {
        res.status(403).json({ code: 'SECURITY_BANNED', action: 'security_banned', message: '账户已被全局封禁' });
        return;
      }

      if (session.user.securityMode) {
        const method = req.method.toUpperCase();
        const pathname = req.originalUrl.split('?')[0] ?? '';
        const readOnly = method === 'GET' || method === 'HEAD';
        const allowed =
          (readOnly &&
            (pathname === '/api/files' ||
              pathname === '/api/files/usage' ||
              pathname === '/api/files/download' ||
              pathname === '/api/files/preview/info' ||
              pathname === '/api/files/preview/content' ||
              pathname === '/api/auth/me')) ||
          pathname === '/api/auth/logout';
        if (!allowed) {
          res.status(403).json({ code: 'SECURITY_MODE', message: '安全模式仅允许预览和下载' });
          return;
        }
      }

      let csrfToken = readCookie(req, CSRF_COOKIE);
      if (!csrfToken) {
        csrfToken = generateCsrfToken();
        res.cookie(CSRF_COOKIE, csrfToken, {
          httpOnly: false,
          sameSite: 'lax',
          path: '/',
          maxAge: Math.max(0, session.expiresAt - Date.now()),
        });
      }

      res.locals.csrfToken = csrfToken;
      res.locals.sessionExpiresAt = session.expiresAt;
      next();
    } catch (error) {
      next(error);
    }
  };
}
