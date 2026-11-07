import type { RequestHandler } from 'express';
import { AUTH_ERROR, AuthError, type AuthService } from '../../core/services/authService.ts';
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
export function createRequireUser(auth: AuthService): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      next(new AuthError(AUTH_ERROR.SESSION_INVALID, '请先登录', 401));
      return;
    }

    try {
      const session = auth.validateSession(token);
      req.user = session.user;

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
