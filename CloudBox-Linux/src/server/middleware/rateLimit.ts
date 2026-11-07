import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { getRequestId } from './requestId.ts';

let onRateLimitAlert: ((info: { ip: string | null; endpoint: string }) => void) | undefined;

function jsonRateLimitHandler(message: string) {
  return (req: Request, res: Response): void => {
    onRateLimitAlert?.({ ip: req.ip ?? null, endpoint: req.path });
    res.status(429).json({
      code: 'RATE_LIMITED',
      message,
      requestId: getRequestId(res),
    });
  };
}

export interface RateLimiters {
  api: RateLimitRequestHandler;
  login: RateLimitRequestHandler;
  upload: RateLimitRequestHandler;
  shares: RateLimitRequestHandler;
  shareDownload: RateLimitRequestHandler;
  register: RateLimitRequestHandler;
  extract: RateLimitRequestHandler;
  scan: RateLimitRequestHandler;
}

/**
 * 涓夋。闄愭祦锛? *  - api锛氬叏鎺ュ彛鍏滃簳锛堝崟 IP 600 娆?鍒嗛挓锛? *  - login锛氱櫥褰曠垎鐮撮槻鎶わ紙鍗?IP 30 娆?15 鍒嗛挓锛? *  - upload锛氫笂浼犻鐜囬檺鍒讹紙鍗?IP 120 娆?鍒嗛挓锛? * 鍗曟満閮ㄧ讲浣跨敤鍐呭瓨璁℃暟鍗冲彲锛涘悗缁瀹炰緥鍙崲 SQLite Store銆? */
export function createRateLimiters(options: {
  onAlert?: (info: { ip: string | null; endpoint: string }) => void;
} = {}): RateLimiters {
  onRateLimitAlert = options.onAlert;
  return {
    api: rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('璇锋眰杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
    login: rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('鐧诲綍灏濊瘯杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
    upload: rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonRateLimitHandler('涓婁紶杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
    shares: rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `user:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('鍒嗕韩鍒涘缓杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
    shareDownload: rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        `share:${ipKeyGenerator(req.ip ?? '0.0.0.0')}:${req.params.token ?? ''}`,
      handler: jsonRateLimitHandler('鍒嗕韩涓嬭浇杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
    register: rateLimit({
      windowMs: 60 * 60_000,
      limit: 2,
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
      handler: jsonRateLimitHandler('瑙ｅ帇鎿嶄綔杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
    scan: rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `scan:${req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0')}`,
      handler: jsonRateLimitHandler('鏌ユ潃鎿嶄綔杩囦簬棰戠箒锛岃绋嶅悗鍐嶈瘯'),
    }),
  };
}

