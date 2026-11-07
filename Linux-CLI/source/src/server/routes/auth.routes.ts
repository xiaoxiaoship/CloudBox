import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { toPublicUser } from '../../core/types/models.ts';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  generateCsrfToken,
  readCookie,
} from '../http/cookies.ts';
import { requestContext } from '../http/context.ts';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1_024),
});

const registerSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[A-Za-z0-9]+$/),
  password: z.string().min(8).max(128),
});

export interface AuthRouterDeps {
  requireUser: RequestHandler;
  csrf: RequestHandler;
  loginLimiter: RequestHandler;
  registerLimiter: RequestHandler;
}

export function createAuthRouter(services: CoreServices, deps: AuthRouterDeps): Router {
  const router = Router();

  router.post('/register', deps.registerLimiter, async (req, res) => {
    const body = registerSchema.parse(req.body);
    const user = await services.registration.register(body, requestContext(req, res));
    res.status(201).json({ user });
  });

  router.post('/login', deps.loginLimiter, async (req, res) => {    const body = loginSchema.parse(req.body);
    const result = await services.auth.login({
      username: body.username,
      password: body.password,
      ...requestContext(req, res),
    });

    const maxAge = Math.max(0, result.expiresAt - Date.now());

    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

    const csrfToken = generateCsrfToken();
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

    res.json({
      user: result.user,
      csrfToken,
      expiresAt: result.expiresAt,
      mustChangePassword: result.mustChangePassword,
    });
  });

  router.post('/logout', deps.csrf, (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      services.auth.logout(token, requestContext(req, res));
    }

    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', deps.requireUser, (req, res) => {
    const user = req.user!;
    const csrfToken = res.locals.csrfToken;

    res.json({
      user: toPublicUser(user),
      usage: services.files.getUsage(user),
      csrfToken: typeof csrfToken === 'string' ? csrfToken : null,
    });
  });

  return router;
}
