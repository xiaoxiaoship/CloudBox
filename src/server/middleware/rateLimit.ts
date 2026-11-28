import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';
import { getRequestId } from './requestId.ts';

export interface RateLimitAlertInfo {
  ip: string | null;
  endpoint: string;
  feature: string;
  featureName: string;
  windowSeconds: number;
  message: string;
}

let onRateLimitAlert: ((info: RateLimitAlertInfo) => void) | undefined;

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

function rateLimitResponse(message = '请求过于频繁，请稍后再试', feature = 'apiRateLimit', featureName = 'API 基础限流', windowSeconds = 60) {
  return (req: Request, res: Response): void => {
    onRateLimitAlert?.({ ip: req.ip ?? null, endpoint: req.path, feature, featureName, windowSeconds, message });
    res.status(429).json({
      code: 'RATE_LIMITED',
      message,
      requestId: getRequestId(res),
    });
  };
}

function jsonRateLimitHandler(message: string, feature = 'apiRateLimit', featureName = 'API 基础限流', windowSeconds = 60) {
  return rateLimitResponse(message, feature, featureName, windowSeconds);
}

export interface RateLimiters {
  api: RateLimitRequestHandler;
  login: RequestHandler;
  loginGuard: RequestHandler;
  upload: RateLimitRequestHandler;
  shares: RateLimitRequestHandler;
  shareDownload: RateLimitRequestHandler;
  guest: RateLimitRequestHandler;
  register: RateLimitRequestHandler;
  extract: RateLimitRequestHandler;
  compress: RateLimitRequestHandler;
  scan: RateLimitRequestHandler;
}

/**
 * API 请求限流。登录限流是运行时计数器，便于管理员修改统计窗口、
 * 次数阈值和锁定时间后立即生效；其余接口使用固定窗口。
 */
export function createRateLimiters(options: {
  onAlert?: (info: RateLimitAlertInfo) => void;
  registerLimit?: () => number;
  securityEnabled?: boolean;
  loginLimit?: number | (() => number);
  loginWindowMs?: number | (() => number);
  loginLockMs?: number | (() => number);
  limits?: {
    api?: number;
    upload?: number;
    shares?: number;
    shareDownload?: number;
    guest?: number;
    extract?: number;
    compress?: number;
    scan?: number;
  };
  dynamicLimits?: () => { api?: number; upload?: number; shares?: number; shareDownload?: number; guest?: number; extract?: number; compress?: number; scan?: number };
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

  const currentLimit = (key: 'api' | 'upload' | 'shares' | 'shareDownload' | 'guest' | 'extract' | 'compress' | 'scan', fallback: number): (() => number) => () =>
    options.dynamicLimits?.()[key] ?? options.limits?.[key] ?? fallback;

  return {
    loginGuard,
    // Keep a harmless second middleware so the auth router shape stays stable.
    login: (_req, _res, next) => next(),
    api: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('api', 600),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('请求过于频繁，请稍后再试', 'apiRateLimit', 'API 基础限流', 60),
    }),
    upload: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('upload', 120),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('上传请求过于频繁，请稍后再试', 'uploadRateLimit', '上传基础限流', 60),
    }),
    shares: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('shares', 10),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `user:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('分享请求过于频繁，请稍后再试', 'shareRateLimit', '分享基础限流', 60),
    }),
    shareDownload: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('shareDownload', 60),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `share:${ipKeyGenerator(req.ip ?? '0.0.0.0')}:${req.params.token ?? ''}`,
      handler: jsonRateLimitHandler('分享下载请求过于频繁，请稍后再试', 'shareDownloadRateLimit', '分享下载基础限流', 60),
    }),
    guest: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('guest', 60),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `guest:${ipKeyGenerator(req.ip ?? '0.0.0.0')}:${req.params.token ?? ''}`,
      handler: jsonRateLimitHandler('访客请求过于频繁，请稍后再试', 'guestRateLimit', '访客基础限流', 60),
    }),
    register: rateLimit({
      windowMs: 60 * 60_000,
      limit: () => options.registerLimit?.() ?? 2,
      skipFailedRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `register:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('注册过于频繁，请稍后再试', 'registerRateLimit', '注册基础限流', 3600),
    }),
    extract: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('extract', 10),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `extract:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('解压请求过于频繁，请稍后再试', 'extractRateLimit', '解压基础限流', 60),
    }),
    compress: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('compress', 10),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `compress:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('压缩请求过于频繁，请稍后再试', 'compressRateLimit', '压缩基础限流', 60),
    }),
    scan: rateLimit({
      windowMs: 60_000,
      limit: currentLimit('scan', 10),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `scan:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('查杀请求过于频繁，请稍后再试', 'scanRateLimit', '查杀基础限流', 60),
    }),
  };
}
