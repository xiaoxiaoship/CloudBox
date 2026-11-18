import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';
import { getRequestId } from './requestId.ts';

let onRateLimitAlert: ((info: { ip: string | null; endpoint: string }) => void) | undefined;

export interface LimitedIp {
  ip: string;
  until: number;
  endpoint: string;
}

const limitedIps = new Map<string, LimitedIp>();

interface LoginBucket {
  windowStart: number;
  count: number;
  lockedUntil: number;
}

const loginBuckets = new Map<string, LoginBucket>();
let loginSettings: {
  enabled: boolean;
  limit: number | (() => number);
  windowMs: number | (() => number);
  lockMs: number | (() => number);
} = {
  enabled: true,
  limit: 30,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

function resolve(value: number | (() => number)): number {
  return typeof value === 'function' ? value() : value;
}

export function listLimitedIps(now = Date.now()): LimitedIp[] {
  for (const [ip, entry] of limitedIps) {
    if (entry.until <= now) limitedIps.delete(ip);
  }
  return [...limitedIps.values()].sort((a, b) => a.until - b.until);
}

export function resetLimitedIps(): void {
  loginBuckets.clear();
  limitedIps.clear();
}

export function clearLimitedIp(ip: string): void {
  loginBuckets.delete(ip);
  limitedIps.delete(ip);
}

export function consumeSimpleLogin(ip: string, limit: number, windowMs: number, lockMs: number): boolean {
  const now = Date.now();
  let bucket = loginBuckets.get(ip);
  if (!bucket) {
    bucket = { windowStart: now, count: 0, lockedUntil: 0 };
    loginBuckets.set(ip, bucket);
  }
  if (bucket.lockedUntil > now) {
    limitedIps.set(ip, { ip, until: bucket.lockedUntil, endpoint: '/api/auth/login' });
    return false;
  }
  if (bucket.lockedUntil > 0) {
    bucket.lockedUntil = 0;
    bucket.windowStart = now;
    bucket.count = 0;
    limitedIps.delete(ip);
  }
  if (now - bucket.windowStart >= windowMs) {
    bucket.windowStart = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    bucket.lockedUntil = now + lockMs;
    limitedIps.set(ip, { ip, until: bucket.lockedUntil, endpoint: '/api/auth/login' });
    return false;
  }
  return true;
}

function rateLimitResponse(message = '请求过于频繁，请稍后再试') {
  return (req: Request, res: Response): void => {
    onRateLimitAlert?.({ ip: req.ip ?? null, endpoint: req.path });
    res.status(429).json({
      code: 'RATE_LIMITED',
      message,
      requestId: getRequestId(res),
    });
  };
}

function jsonRateLimitHandler(message: string) {
  return rateLimitResponse(message);
}

export interface RateLimiters {
  api: RateLimitRequestHandler;
  login: RequestHandler;
  loginGuard: RequestHandler;
  upload: RateLimitRequestHandler;
  shares: RateLimitRequestHandler;
  shareDownload: RateLimitRequestHandler;
  register: RateLimitRequestHandler;
  extract: RateLimitRequestHandler;
  scan: RateLimitRequestHandler;
}

/**
 * API 请求限流。登录限流是运行时计数器，便于管理员修改统计窗口、
 * 次数阈值和锁定时间后立即生效；其余接口使用固定窗口。
 */
export function createRateLimiters(options: {
  onAlert?: (info: { ip: string | null; endpoint: string }) => void;
  registerLimit?: () => number;
  securityEnabled?: boolean;
  loginLimit?: number | (() => number);
  loginWindowMs?: number | (() => number);
  loginLockMs?: number | (() => number);
} = {}): RateLimiters {
  onRateLimitAlert = options.onAlert;
  const securityEnabled = options.securityEnabled !== false;
  loginSettings = {
    enabled: securityEnabled,
    limit: options.loginLimit ?? 30,
    windowMs: options.loginWindowMs ?? 15 * 60_000,
    lockMs: options.loginLockMs ?? options.loginWindowMs ?? 15 * 60_000,
  };

  // Legacy per-IP login limiting is retired in favor of security.policy.
  // Keep the middleware shape so existing route wiring remains harmless.
  const loginGuard: RequestHandler = (_req, _res, next) => next();

  return {
    loginGuard,
    // Keep a harmless second middleware so the auth router shape stays stable.
    login: (_req, _res, next) => next(),
    api: rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('请求过于频繁，请稍后再试'),
    }),
    upload: rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('上传请求过于频繁，请稍后再试'),
    }),
    shares: rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `user:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('分享请求过于频繁，请稍后再试'),
    }),
    shareDownload: rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `share:${ipKeyGenerator(req.ip ?? '0.0.0.0')}:${req.params.token ?? ''}`,
      handler: jsonRateLimitHandler('分享下载请求过于频繁，请稍后再试'),
    }),
    register: rateLimit({
      windowMs: 60 * 60_000,
      limit: () => options.registerLimit?.() ?? 2,
      skipFailedRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `register:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('注册过于频繁，请稍后再试'),
    }),
    extract: rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `extract:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('解压请求过于频繁，请稍后再试'),
    }),
    scan: rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `scan:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('查杀请求过于频繁，请稍后再试'),
    }),
  };
}
