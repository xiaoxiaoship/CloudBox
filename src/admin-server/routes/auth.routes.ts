import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AdminAuthError, type AdminAuthService } from '../../core/services/admin/adminAuthService.ts';
import { AdminError } from '../../core/services/admin/adminUserService.ts';
import type { InitTokenService } from '../../server-entry/initToken.ts';
import {
  clearAdminCookies,
  createAdminCsrfToken,
  createRequireAdmin,
  setAdminCookies,
  adminUser,
} from '../middleware/adminAuth.ts';
import { getRequestId } from '../../server/middleware/requestId.ts';
import { ADMIN_SESSION_COOKIE } from '../middleware/adminAuth.ts';
import { readCookie } from '../../server/http/cookies.ts';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

const setupSchema = z.object({
  token: z.string().min(1).max(256),
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
});

function authError(error: unknown, res: import('express').Response): boolean {
  if (error instanceof AdminAuthError) {
    res.status(error.httpStatus).json({ code: error.code, message: error.message });
    return true;
  }
  if (error instanceof AdminError) {
    const status = error.code === 'ADMIN_EXISTS' ? 409 : error.code === 'WEAK_PASSWORD' ? 400 : 400;
    res.status(status).json({ code: error.code, message: error.message });
    return true;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      code: 'INVALID_INPUT',
      message: error.issues[0]?.message ?? '参数不合法',
      requestId: getRequestId(res),
    });
    return true;
  }
  return false;
}

export function createAdminAuthRouter(
  auth: AdminAuthService,
  initToken: InitTokenService,
  csrf: RequestHandler,
): Router {
  const router = Router();
  const requireAdmin = createRequireAdmin(auth);

  router.get('/auth/status', (req, res) => {
    const csrfToken = createAdminCsrfToken();
    res.cookie('admin_csrf', csrfToken, {
      httpOnly: false,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
    });
    const validated = auth.validate(readCookie(req, ADMIN_SESSION_COOKIE), {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: getRequestId(res),
    });
    res.json({
      needsSetup: auth.needsSetup(),
      authenticated: validated !== null,
      user: validated?.user ?? null,
      csrfToken,
    });
  });

  router.get('/auth/me', requireAdmin, (_req, res) => {
    res.json({ user: adminUser(res) });
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const body = loginSchema.parse(req.body);
      const result = await auth.login(body.username, body.password, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: getRequestId(res),
      });
      const csrfToken = createAdminCsrfToken();
      setAdminCookies(req, res, result.token, csrfToken, result.expiresAt - Date.now());
      res.json({ user: result.user, expiresAt: result.expiresAt, csrfToken });
    } catch (error) {
      if (!authError(error, res)) throw error;
    }
  });

  router.post('/auth/logout', requireAdmin, csrf, (req, res) => {
    auth.logout(res.locals.adminToken as string | null);
    clearAdminCookies(req, res);
    res.status(204).end();
  });

  router.post('/setup', async (req, res) => {
    try {
      const body = setupSchema.parse(req.body);
      if (!initToken.verify(body.token)) {
        res.status(403).json({ code: 'ADMIN_SETUP_TOKEN_INVALID', message: '初始化 token 无效或已过期' });
        return;
      }
      if (!auth.needsSetup()) {
        res.status(409).json({ code: 'ADMIN_EXISTS', message: '管理员已存在' });
        return;
      }
      const result = await auth.setup(body.username, body.password, {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: getRequestId(res),
      });
      initToken.consume();
      const csrfToken = createAdminCsrfToken();
      setAdminCookies(req, res, result.token, csrfToken, result.expiresAt - Date.now());
      res.status(201).json({ user: result.user, expiresAt: result.expiresAt, csrfToken });
    } catch (error) {
      if (!authError(error, res)) throw error;
    }
  });

  return router;
}
