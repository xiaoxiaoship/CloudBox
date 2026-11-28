import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import type { CapService } from '../cap/capService.ts';
import type { SecurityPolicyService, PolicyRule } from '../../core/services/securityPolicyService.ts';
import { toPublicUser } from '../../core/types/models.ts';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  generateCsrfToken,
  readCookie,
} from '../http/cookies.ts';
import { requestContext } from '../http/context.ts';
import { consumeSimpleLogin } from '../middleware/rateLimit.ts';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1_024),
});

const renameSchema = z.object({
  username: z.string().min(1).max(64),
});

const registerSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[A-Za-z0-9]+$/),
  password: z.string().min(8).max(128),
});

export interface AuthRouterDeps {
  requireUser: RequestHandler;
  csrf: RequestHandler;
  loginGuard: RequestHandler;
  loginLimiter: RequestHandler;
  registerLimiter: RequestHandler;
  cap: CapService;
  policy: SecurityPolicyService;
}

export function createAuthRouter(services: CoreServices, deps: AuthRouterDeps): Router {
  const router = Router();
  const legacyIpGuard: RequestHandler = (req, res, next) => {
    if (services.settings.get('security.mode') !== 'simple') { next(); return; }
    const ip = req.ip ?? 'unknown';
    const allowed = consumeSimpleLogin(
      ip,
      services.settings.get('security.ipLoginLimit'),
      services.settings.get('security.ipWindowMinutes') * 60_000,
      services.settings.get('security.ipLockMinutes') * 60_000,
    );
    if (!allowed) {
      res.status(429).json({ code: 'RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' });
      return;
    }
    next();
  };

  const banMinutes = (rule: PolicyRule, escalation = 0): number => {
    if (String(rule.config.banMode ?? '') === 'variable') {
      const base = Math.max(1, Number(rule.config.baseMinutes ?? 1));
      const max = Math.max(base, Number(rule.config.maxMinutes ?? 60));
      return Math.min(max, base * 2 ** Math.max(0, escalation));
    }
    const raw = rule.config.banMinutes ?? rule.config.fixedMinutes ?? (rule.config.banHours === undefined ? undefined : Number(rule.config.banHours) * 60);
    return raw === undefined ? 10 : Number(raw);
  };
  const featureLabel = (feature: string): string => ({
    loginFailure: '登录失败限制', registrationLimit: '注册量限制', cap: 'Cap 人机验证',
    renameLimit: '改名限制', concurrentSessions: '同时在线人数限制', historyIpLimit: '历史 IP 计数限制',
    concurrentIpLimit: '同时在线 IP 量限制', global: '全局封禁',
  } as Record<string, string>)[feature] ?? feature;
  const banned = (req: Request, res: Response, scope: 'ip' | 'account' | 'global', target: string): boolean => {
    if (deps.policy.isAllowed(scope, target)) return false;
    const active = deps.policy.activeBan(scope, target);
    if (active === null) return false;
    const remaining = Math.max(1, Math.ceil((active.until - Date.now()) / 60_000));
    const scopeLabel = scope === 'ip' ? 'IP' : scope === 'account' ? '账户' : '全局';
    services.events.emit('security.limit', { category: '安全策略', scope, target, feature: active.feature, featureName: featureLabel(active.feature), remainingMinutes: remaining, message: `${scopeLabel}${featureLabel(active.feature)}已触发，剩余 ${remaining} 分钟` });
    res.status(403).json({ code: 'SECURITY_BANNED', action: 'security_banned', feature: active.feature, until: active.until, message: `${scopeLabel}${featureLabel(active.feature)}已触发，剩余 ${remaining} 分钟` });
    return true;
  };
  const checkLoginPolicy = (req: Request, res: Response, user: { id: number; failedAttempts: number; username?: string } | null): boolean => {
    const ip = req.ip ?? 'unknown';
    const onlineWindowMs = services.settings.getLowLevel().onlineWindowSeconds * 1_000;
    const globalLoginRule = deps.policy.rule('loginFailure', 'global');
    if (globalLoginRule !== null) {
      const globalWindow = Math.max(1, Number(globalLoginRule.config.windowMinutes ?? 15)) * 60_000;
      const failures = services.audit.list({ limit: 500 }).filter((entry) => entry.action === 'auth.login.failure' && entry.ts >= Date.now() - globalWindow);
      if (failures.length >= Number(globalLoginRule.config.threshold ?? 5)) {
        deps.policy.ban('global', 'server', 'loginFailure', banMinutes(globalLoginRule, deps.policy.countOf('global', 'server', 'loginFailure')));
        return banned(req, res, 'global', 'server');
      }
    }
    const ipAllowed = deps.policy.isAllowed('ip', ip);
    const accountAllowed = user !== null && (deps.policy.isAllowed('account', String(user.id)) || (user.username !== undefined && deps.policy.isAllowed('account', user.username)));
    if (!ipAllowed && banned(req, res, 'ip', ip)) return true;
    if (user !== null && !accountAllowed && banned(req, res, 'account', String(user.id))) return true;
    const ipReset = deps.policy.resetAt('ip', ip);
    const accountReset = user !== null ? deps.policy.resetAt('account', String(user.id)) : 0;
    const ipSessionRule = deps.policy.rule('concurrentSessions', 'ip');
    if (!ipAllowed && ipSessionRule !== null && services.sessions.countConnectedForIp(ip, Date.now(), onlineWindowMs, ipReset) >= Number(ipSessionRule.config.max ?? 3)) {
      deps.policy.ban('ip', ip, 'concurrentSessions', banMinutes(ipSessionRule));
      return banned(req, res, 'ip', ip);
    }
    const ipRule = deps.policy.rule('loginFailure', 'ip');
    if (!ipAllowed && ipRule !== null) {
      const windowMs = Number(ipRule.config.windowMinutes ?? 15) * 60_000;
      const since = Math.max(Date.now() - windowMs, ipReset);
      const failures = services.audit.list({ limit: 500 }).filter((entry) => entry.action === 'auth.login.failure' && entry.ip === ip && entry.ts >= since);
      if (failures.length >= Number(ipRule.config.threshold ?? 5)) {
        deps.policy.ban('ip', ip, 'loginFailure', banMinutes(ipRule, deps.policy.countOf('ip', ip, 'loginFailure')));
        return banned(req, res, 'ip', ip);
      }
    }
    if (user !== null) {
      const accountRule = deps.policy.rule('loginFailure', 'account');
      if (!accountAllowed && accountRule !== null && user.failedAttempts >= Number(accountRule.config.threshold ?? 5)) {
        deps.policy.ban('account', String(user.id), 'loginFailure', banMinutes(accountRule, deps.policy.countOf('account', String(user.id), 'loginFailure')));
        return banned(req, res, 'account', String(user.id));
      }
      const sessionsRule = deps.policy.rule('concurrentSessions', 'account');
      if (!accountAllowed && sessionsRule !== null && services.sessions.countConnected(user.id, Date.now(), onlineWindowMs, accountReset) >= Number(sessionsRule.config.max ?? 3)) {
        deps.policy.ban('account', String(user.id), 'concurrentSessions', banMinutes(sessionsRule));
        return banned(req, res, 'account', String(user.id));
      }
      const historyRule = deps.policy.rule('historyIpLimit', 'account');
      if (!accountAllowed && historyRule !== null && services.loginIps.listForUser(user.id, accountReset).length >= Number(historyRule.config.max ?? 5)) {
        deps.policy.ban('account', String(user.id), 'historyIpLimit', banMinutes(historyRule));
        return banned(req, res, 'account', String(user.id));
      }
      const ipCountRule = deps.policy.rule('concurrentIpLimit', 'account');
      if (!accountAllowed && ipCountRule !== null && services.sessions.listConnectedIps(user.id, Date.now(), onlineWindowMs, accountReset).length >= Number(ipCountRule.config.max ?? 3)) {
        deps.policy.ban('account', String(user.id), 'concurrentIpLimit', banMinutes(ipCountRule));
        return banned(req, res, 'account', String(user.id));
      }
    }
    return false;
  };

  router.post('/register', deps.registerLimiter, async (req, res) => {
    const body = registerSchema.parse(req.body);
    const registerIp = req.ip ?? 'unknown';
    if (services.settings.get('security.mode') === 'advanced' && banned(req, res, 'ip', registerIp)) return;
    const registrationRule = services.settings.get('security.mode') === 'advanced' ? deps.policy.rule('registrationLimit', 'ip') : null;
    if (registrationRule !== null) {
      const windowMs = Number(registrationRule.config.windowMinutes ?? 10) * 60_000;
      const resetAt = deps.policy.resetAt('ip', registerIp);
      const since = Math.max(Date.now() - windowMs, resetAt);
      const recent = services.audit.list({ limit: 500 }).filter((entry) => entry.action === 'user.register' && entry.ip === registerIp && entry.ts >= since);
      if (recent.length >= Number(registrationRule.config.threshold ?? 2)) {
        deps.policy.ban('ip', registerIp, 'registrationLimit', banMinutes(registrationRule));
        banned(req, res, 'ip', registerIp);
        return;
      }
    }
    if (services.settings.get('security.mode') === 'advanced' && req.secure && deps.cap.enabled() && deps.policy.rule('cap', 'ip') !== null) {
      const since = Date.now() - 10 * 60_000;
      const recent = services.audit
        .list({ limit: 500 })
        .filter((entry) => entry.action === 'user.register' && entry.ip === req.ip && entry.ts >= since);
      if (recent.length >= deps.cap.registrationLimit() && !deps.cap.hasValidToken(req)) {
        res.status(403).json(deps.cap.requireResponse());
        return;
      }
    }
    const user = await services.registration.register(body, requestContext(req, res));
    res.status(201).json({ user });
  });

  router.post('/login', legacyIpGuard, deps.loginGuard, deps.loginLimiter, async (req, res) => {    const body = loginSchema.parse(req.body);
    const loginUser = services.users.findByUsername(body.username);
    const advancedMode = services.settings.get('security.mode') === 'advanced';
    if (advancedMode && checkLoginPolicy(req, res, loginUser)) return;
    const capAccountRule = deps.policy.rule('cap', 'account');
    const capIpRule = deps.policy.rule('cap', 'ip');
    if (advancedMode && req.secure && deps.cap.enabled() && (capAccountRule !== null || capIpRule !== null)) {
      const ip = req.ip ?? 'unknown';
      const accountThreshold = Math.max(1, capAccountRule !== null ? Number(capAccountRule.config.threshold ?? 3) : deps.cap.loginThreshold());
      const accountMode = String(capAccountRule?.config.mode ?? 'window');
      const accountWindow = Math.max(1, Number(capAccountRule?.config.windowMinutes ?? 15)) * 60_000;
      const accountFailures = loginUser !== null && accountMode === 'window'
        ? services.audit.list({ limit: 500 }).filter((entry) => entry.action === 'auth.login.failure' && entry.actorId === loginUser.id && entry.ts >= Date.now() - accountWindow).length
        : loginUser?.failedAttempts ?? 0;
      const accountLevel = loginUser !== null ? Math.floor(accountFailures / accountThreshold) : 0;
      const accountKey = loginUser !== null ? `account:${loginUser.id}` : '';
      const ipResetAt = deps.policy.resetAt('ip', ip);
      const ipMode = String(capIpRule?.config.mode ?? 'window');
      const ipWindow = Math.max(1, Number(capIpRule?.config.windowMinutes ?? 15)) * 60_000;
      const ipSince = ipMode === 'window' ? Math.max(ipResetAt, Date.now() - ipWindow) : ipResetAt;
      const ipFailures = services.audit.list({ limit: 500 }).filter((entry) => entry.action === 'auth.login.failure' && entry.ip === ip && entry.ts >= ipSince);
      const ipThreshold = capIpRule !== null ? Math.max(1, Number(capIpRule.config.threshold ?? 3)) : Number.POSITIVE_INFINITY;
      const ipLevel = Number.isFinite(ipThreshold) ? Math.floor(ipFailures.length / ipThreshold) : 0;
      const ipKey = `ip:${ip}`;
      const accountNeeds = loginUser !== null && deps.cap.needsChallenge(accountKey, accountLevel);
      const ipNeeds = deps.cap.needsChallenge(ipKey, ipLevel);
      if (accountNeeds || ipNeeds) {
        if (!deps.cap.hasValidToken(req)) {
          res.status(403).json(deps.cap.requireResponse());
          return;
        }
        if (accountNeeds) deps.cap.markChallengePassed(accountKey, accountLevel);
        if (ipNeeds) deps.cap.markChallengePassed(ipKey, ipLevel);
      }
    }
    const result = await services.auth.login({
      username: body.username,
      password: body.password,
      ...requestContext(req, res),
    });

    deps.cap.clearAccountMark(result.user.id);
    deps.cap.clearIpMark(req.ip ?? 'unknown');

    const maxAge = Math.max(0, result.expiresAt - Date.now());

    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: req.secure,
      maxAge,
    });

    const csrfToken = generateCsrfToken();
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: req.secure,
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

    res.clearCookie(SESSION_COOKIE, { path: '/', secure: req.secure });
    res.clearCookie(CSRF_COOKIE, { path: '/', secure: req.secure });
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

  router.patch('/username', deps.requireUser, deps.csrf, async (req, res) => {
    const body = renameSchema.parse(req.body);
    const user = await services.auth.rename(
      req.user!,
      body.username,
      requestContext(req, res),
    );
    res.json({ user });
  });

  router.post('/avatar', deps.requireUser, deps.csrf, async (req, res) => {
    const user = req.user!;
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar : '';
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
      res.status(400).json({ error: { code: 'AVATAR_INVALID', message: '头像格式必须是 PNG/JPEG/WebP' } });
      return;
    }
    const maxAvatarBytes = services.settings.getLowLevel().maxAvatarBytes;
    if (Buffer.byteLength(avatar, 'utf8') > maxAvatarBytes) {
      res.status(413).json({
        error: {
          code: 'AVATAR_TOO_LARGE',
          message: `头像 data URL 不能超过 ${Math.floor(maxAvatarBytes / 1024)}KB`,
        },
      });
      return;
    }
    const saved = await services.auth.changeAvatar(user, avatar, requestContext(req, res));
    res.json({ avatarDataUrl: saved });
  });

  router.delete('/avatar', deps.requireUser, deps.csrf, async (req, res) => {
    await services.auth.changeAvatar(req.user!, null, requestContext(req, res));
    res.status(204).end();
  });

  return router;
}
