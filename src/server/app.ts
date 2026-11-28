import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { CoreServices } from '../core/container.ts';
import { createCsrfProtection } from './middleware/csrf.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { createRateLimiters } from './middleware/rateLimit.ts';
import { createRequireUser } from './middleware/requireUser.ts';
import { createIpsMiddleware } from './middleware/ips.ts';
import { createApiFloodMiddleware } from './middleware/apiFlood.ts';
import { requestId } from './middleware/requestId.ts';
import { createAuthRouter } from './routes/auth.routes.ts';
import { createCapRouter } from './routes/cap.routes.ts';
import { createCapService } from './cap/capService.ts';
import { createAiRouter } from './routes/ai.routes.ts';
import { createFilesRouter } from './routes/files.routes.ts';
import { createGuestRouter, createPublicGuestRouter } from './routes/guest.routes.ts';
import { createHealthRouter } from './routes/health.routes.ts';
import { createHostingApiRouter, createHostingSiteRouter } from './routes/hosting.routes.ts';
import { createPluginsRouter } from './routes/plugins.routes.ts';
import {
  createPublicSharesRouter,
  createSharesRouter,
} from './routes/shares.routes.ts';
import { createTasksRouter } from './routes/tasks.routes.ts';
import { createAnnouncementsRouter, createAdminAnnouncementsRouter } from './routes/announcements.routes.ts';
import { createSystemRouter } from './routes/system.routes.ts';
import { recordDownloadBytes } from './traffic.ts';

/** 默认构建产物目录；Electron 主进程会传入 app.getAppPath() 下的绝对路径 */
const DEFAULT_WEB_DIST = path.resolve(process.cwd(), 'dist', 'web');

const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');
const WEB_OVERRIDE_CSP = WEB_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");

export interface CreateAppOptions {
  services: CoreServices;
  version: string;
  /** 用户 Web 构建产物目录；传 null 可禁用静态托管（测试/纯 API 场景） */
  webDist?: string | null;
  /** 登录页根证书下载：仅在 HTTPS 且已生成私有 CA 时可用 */
  getPublicRootCa?: () => { enabled: boolean; certPath: string | null };
}

/**
 * 组装 Express 应用（纯工厂，不负责监听端口）。
 * supertest / 集成测试直接使用，Electron 主进程也能控制启停。
 */
export function createApp(options: CreateAppOptions): Express {
  const { services } = options;
  const app = express();
  const cap = createCapService(services.settings);

  app.disable('x-powered-by');

  // The local TCP front door attaches the verified PROXY v2 source address.
  // It takes precedence over Express's proxy-derived req.ip.
  app.use((req, _res, next) => {
    const socket = req.socket as unknown as { realIp?: string; _parent?: { realIp?: string } };
    const realIp = socket.realIp ?? socket._parent?.realIp;
    if (realIp) {
      Object.defineProperty(req, 'ip', { value: realIp, configurable: true, enumerable: true, writable: true });
      if (app.get('trust proxy')) {
        req.headers['x-forwarded-for'] = realIp;
      } else {
        delete req.headers['x-forwarded-for'];
      }
    }
    next();
  });
  const frpHttpProxy = services.settings.get('frp.enabled')
    && services.settings.get('frp.tunnelType') !== 'tcp';
  app.set('trust proxy', services.settings.get('network.trustProxy') || frpHttpProxy ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const countBody = (chunk: unknown): void => {
      if (typeof chunk === 'string') {
        recordDownloadBytes(Buffer.byteLength(chunk));
      } else if (chunk instanceof Uint8Array) {
        recordDownloadBytes(chunk.byteLength);
      }
    };
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    res.write = ((chunk: any, encoding?: any, callback?: any) => {
      countBody(chunk);
      return originalWrite(chunk, encoding, callback);
    }) as typeof res.write;
    res.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (typeof chunk !== 'function') countBody(chunk);
      return originalEnd(chunk, encoding, callback);
    }) as typeof res.end;
    next();
  });

  const lowLevel = services.settings.getLowLevel();
  const limiters = createRateLimiters({
    dynamicLimits: () => {
      const current = services.settings.getLowLevel();
      return {
        api: current.apiRateLimit,
        upload: current.uploadRateLimit,
        shares: current.shareRateLimit,
        shareDownload: current.shareDownloadRateLimit,
        extract: current.extractRateLimit,
        compress: current.compressRateLimit,
        scan: current.scanRateLimit,
      };
    },
    limits: {
      api: lowLevel.apiRateLimit,
      upload: lowLevel.uploadRateLimit,
      shares: lowLevel.shareRateLimit,
      shareDownload: lowLevel.shareDownloadRateLimit,
      extract: lowLevel.extractRateLimit,
      compress: lowLevel.compressRateLimit,
      scan: lowLevel.scanRateLimit,
    },
    onAlert: (info) => services.events.emit('security.alert', {
      category: '基础限流',
      scope: 'ip',
      target: info.ip ?? 'unknown',
      feature: info.feature,
      featureName: info.featureName,
      remainingMinutes: Math.max(1, Math.ceil(info.windowSeconds / 60)),
      message: `${info.message}（${info.endpoint}）`,
    } as Record<string, unknown>),
    securityEnabled: services.settings.get('security.lockEnabled'),
    loginLimit: () => services.settings.get('security.ipLoginLimit'),
    loginWindowMs: () => services.settings.get('security.ipWindowMinutes') * 60_000,
    loginLockMs: () => services.settings.get('security.ipLockMinutes') * 60_000,
    registerLimit: () => services.settings.get('security.simpleRegisterLimit'),
  });
  const requireUser = createRequireUser(services.auth, services.securityPolicy, () => services.settings.get('security.mode') === 'advanced');
  const csrf = createCsrfProtection(services.audit);

  app.use(createIpsMiddleware(services));

  app.use('/health', createHealthRouter({ db: services.db, version: options.version }));

  app.use('/api', (req, res, next) => {
    if (services.settings.get('security.mode') !== 'advanced') { next(); return; }
    const ip = req.ip ?? 'unknown';
    if (services.securityPolicy.isDenied('ip', ip)) {
      res.status(403).json({ code: 'SECURITY_BANNED', action: 'security_banned', message: 'IP 在黑名单中' });
      return;
    }
    if (!services.securityPolicy.isAllowed('ip', ip) && services.securityPolicy.activeBan('ip', ip)?.feature === 'global') {
      res.status(403).json({ code: 'SECURITY_BANNED', action: 'security_banned', message: 'IP 已被全局封禁' });
      return;
    }
    next();
  });
  app.use('/api', limiters.api);
  app.use(createApiFloodMiddleware(services));
  app.use('/api/cap', createCapRouter(cap));

  app.get('/api/public/root-ca.crt', (req, res, next) => {
    const rootCa = options.getPublicRootCa?.();
    if (!rootCa?.enabled || rootCa.certPath === null || !existsSync(rootCa.certPath)) {
      res.status(404).json({ code: 'NOT_FOUND', message: '根证书不可用' });
      return;
    }

    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="root-ca.crt"');
    res.setHeader('Cache-Control', 'no-store');

    const stream = createReadStream(rootCa.certPath);
    stream.on('error', next);
    stream.pipe(res);
  });

  app.get('/api/public/settings', (_req, res) => {
    res.json({
      allow_public_registration: services.settings.get('allow_public_registration'),
      permissions: {
        allow_user_preview_image: services.settings.get('allow_user_preview_image'),
        allow_user_preview_video: services.settings.get('allow_user_preview_video'),
        allow_user_preview_pdf: services.settings.get('allow_user_preview_pdf'),
        allow_user_preview_office: services.settings.get('allow_user_preview_office'),
        allow_user_extract: services.settings.get('allow_user_extract'),
        allow_user_scan: services.settings.get('allow_user_scan'),
        allow_user_compress: services.settings.get('allow_user_compress'),
        allow_user_direct_share: services.settings.get('allow_user_direct_share'),
        allow_user_archive_preview: services.settings.get('allow_user_archive_preview'),
        allow_guest_mode: services.settings.get('allow_guest_mode'),
      },
      scan_enabled: services.settings.get('scan.enabled'),
      ai_enabled: services.settings.get('ai.enabled'),
      ai_mode: services.settings.get('ai.mode'),
      hosting_enabled: services.settings.get('hosting.enabled'),
      hosting_mode: services.settings.get('hosting.mode'),
      guest_address_mode: services.settings.get('guest.addressMode'),
      hosting_base_url: services.settings.get('hosting.base_url'),
      upload_queue_concurrency: services.settings.getLowLevel().uploadQueueConcurrency,
    });
  });

  app.use('/api/hosting', requireUser, createHostingApiRouter(services, { csrf }));
  app.use('/host', createHostingSiteRouter(services));

  app.use('/api/ai', requireUser, createAiRouter(services, { csrf }));
  app.use('/api/system', requireUser, createSystemRouter(services, { version: options.version }));

  // Reserved admin namespace: every route must be an authenticated admin and
  // every mutating request must pass CSRF. No /api/admin route is mounted today.
  app.use('/api/admin', requireUser, (req, res, next) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ code: 'FORBIDDEN', message: '仅管理员可以访问该接口' });
      return;
    }
    next();
  }, csrf);

  app.get('/api/public/plugin-theme.css', (_req, res) => {
    res.type('text/css').send(services.plugins.getThemeCss());
  });

  app.use(
    '/api/plugins',
    requireUser,
    createPluginsRouter(services, { csrf }),
  );

  app.get('/plugin-web/:name/ui/*splat', (req, res) => {
    const name = req.params.name ?? '';
    const splat = req.params.splat;
    const relative = Array.isArray(splat) ? splat.join('/') : (splat ?? '');
    const target = services.plugins.getUiAsset(name, relative === '' ? 'index.html' : relative);
    if (target === null) { res.status(404).end(); return; }
    res.sendFile(target);
  });

  app.get('/plugin-web/:name/*splat', (req, res) => {
    const name = req.params.name ?? '';
    const splat = req.params.splat;
    const relative = Array.isArray(splat) ? splat.join('/') : (splat ?? '');
    const target = services.plugins.getWebOverrideAsset(name, relative);
    if (target === null) {
      res.status(404).json({ code: 'PLUGIN_ASSET_NOT_FOUND', message: '插件资源不存在' });
      return;
    }
    res.type(path.extname(target)).send(readFileSync(target));
  });

  app.use(
    '/api/public/s',
    createPublicSharesRouter(services, {
      shareDownloadLimiter: limiters.shareDownload,
    }),
  );

  // 访客公开接口：不经过 requireUser，只读，独立 cb_guest 会话
  app.use(
    '/api/public/guest',
    createPublicGuestRouter(services, {
      guestLimiter: limiters.guest,
      downloadLimiter: limiters.shareDownload,
    }),
  );

  app.use(
    '/api/shares',
    requireUser,
    createSharesRouter(services, {
      csrf,
      shareLimiter: limiters.shares,
      cap,
      policy: services.securityPolicy,
    }),
  );

  app.use('/api/guest', requireUser, createGuestRouter(services, { csrf }));

  const registerLimiter: RequestHandler = (req, res, next) => {
    if (services.settings.get('security.mode') === 'simple') limiters.register(req, res, next);
    else next();
  };

  app.use(
    '/api/auth',
    createAuthRouter(services, {
      requireUser,
      csrf,
      loginGuard: limiters.loginGuard,
      loginLimiter: limiters.login,
      registerLimiter,
      cap,
      policy: services.securityPolicy,
    }),
  );
  app.use(
    '/api/files',
    requireUser,
    createFilesRouter(services, {
      csrf,
      uploadLimiter: limiters.upload,
      extractLimiter: limiters.extract,
      scanLimiter: limiters.scan,
      compressLimiter: limiters.compress,
    }),
  );
  app.use('/api/tasks', requireUser, createTasksRouter(services));
  app.use('/api/announcements', requireUser, createAnnouncementsRouter(services, { csrf }));
  app.use('/api/admin/announcements', createAdminAnnouncementsRouter(services));

  const webDist = options.webDist === undefined ? DEFAULT_WEB_DIST : options.webDist;
  if (webDist !== null && existsSync(path.join(webDist, 'index.html'))) {
    app.use(
      express.static(webDist, {
        index: false,
        etag: true,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Content-Security-Policy', WEB_CSP);
          }
        },
      }),
    );

    // SPA 回退：只接管浏览器导航，不吞掉 /api 与 /health 的 JSON 404
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      if (req.path.startsWith('/api') || req.path === '/health') {
        next();
        return;
      }
      if (!req.accepts('html')) {
        next();
        return;
      }

      res.setHeader('Content-Security-Policy', WEB_CSP);
      res.setHeader('Cache-Control', 'no-cache');

      const override = services.plugins.getWebOverride(req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : null);
      if (override !== null) {
        res.setHeader('Content-Security-Policy', WEB_OVERRIDE_CSP);
        res.status(200).type('html').send(override.html);
        return;
      }

      const indexPath = path.join(webDist, 'index.html');
      let html = readFileSync(indexPath, 'utf8');
      if (services.plugins.getThemeCss().trim() !== '') {
        html = html.replace(
          '</head>',
          '  <link rel="stylesheet" href="/api/public/plugin-theme.css" />\n</head>',
        );
      }
      res.status(200).type('html').send(html);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler(services.events));

  return app;
}
