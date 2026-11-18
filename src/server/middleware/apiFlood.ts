import type { RequestHandler } from 'express';
import type { CoreServices } from '../../core/container.ts';
import { SESSION_COOKIE, readCookie } from '../http/cookies.ts';

interface Bucket {
  windowStart: number;
  count: number;
  recorded: boolean;
}

const buckets = new Map<string, Bucket>();

function isExcluded(pathname: string, method: string, range: string | undefined): boolean {
  if (pathname === '/health' || pathname === '/api/health') return true;
  if (method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(pathname)) return true;
  if (pathname === '/api/auth/me') return true;
  if (range !== undefined && range.length > 0) return true;
  return false;
}

export function createApiFloodMiddleware(services: CoreServices): RequestHandler {
  return (req, res, next) => {
    if (services.settings.get('security.mode') !== 'advanced') {
      next();
      return;
    }
    if (!req.path.startsWith('/api') || isExcluded(req.path, req.method, req.headers.range)) {
      next();
      return;
    }

    const ip = req.ip ?? 'unknown';
    let userId: number | null = null;
    try {
      const token = readCookie(req, SESSION_COOKIE);
      if (token) userId = services.auth.validateSession(token).user.id;
    } catch { /* unauthenticated IP/global scope */ }
    const accountRule = userId !== null ? services.securityPolicy.rule('apiFlood', 'account') : null;
    const globalRule = services.securityPolicy.rule('apiFlood', 'global');
    const ipRule = services.securityPolicy.rule('apiFlood', 'ip');
    const rule = accountRule ?? ipRule ?? globalRule;
    if (rule === null) {
      next();
      return;
    }
    const scope = accountRule !== null ? 'account' : ipRule !== null ? 'ip' : 'global';
    const target = scope === 'global' ? 'server' : scope === 'account' ? String(userId) : ip;
    const windowMs = Math.max(1, Number(rule.config.windowMinutes ?? 1)) * 60_000;
    const threshold = Math.max(1, Number(rule.config.threshold ?? 120));
    const key = `${scope}:${target}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, count: 0, recorded: false };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count >= threshold && !bucket.recorded) {
      bucket.recorded = true;
      services.securityPolicy.addCount(scope, target, 'apiFlood', Math.max(1, Number(rule.config.recordValue ?? 1)));
      services.events.emit('security.limit', { category: 'API 泛洪拦截', scope, target, feature: 'apiFlood', featureName: 'API 泛洪拦截', remainingMinutes: 0, message: `API 请求量达到阈值（${threshold}/${Math.round(windowMs / 60_000)} 分钟）` });
    }
    next();
  };
}
