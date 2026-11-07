import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { CoreServices } from '../core/container.ts';
import { createCsrfProtection } from './middleware/csrf.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { createRateLimiters } from './middleware/rateLimit.ts';
import { createRequireUser } from './middleware/requireUser.ts';
import { requestId } from './middleware/requestId.ts';
import { createAuthRouter } from './routes/auth.routes.ts';
import { createAiRouter } from './routes/ai.routes.ts';
import { createFilesRouter } from './routes/files.routes.ts';
import { createHealthRouter } from './routes/health.routes.ts';
import { createHostingApiRouter, createHostingSiteRouter } from './routes/hosting.routes.ts';
import { createPluginsRouter } from './routes/plugins.routes.ts';
import {
  createPublicSharesRouter,
  createSharesRouter,
} from './routes/shares.routes.ts';
import { createTasksRouter } from './routes/tasks.routes.ts';
import { recordDownloadBytes, recordUploadBytes } from './traffic.ts';

/** 默认构建产物目录；Electron 主进程会传入 app.getAppPath() 下的绝对路径 */
const DEFAULT_WEB_DIST = path.resolve(process.cwd(), 'dist', 'web');

const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

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

  app.disable('x-powered-by');
  app.set('trust proxy', services.settings.get('network.trustProxy') ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const uploadLength = Number(req.headers['content-length']);
    if (Number.isFinite(uploadLength)) recordUploadBytes(uploadLength);
    res.on('finish', () => {
      const length = Number(res.getHeader('content-length'));
      if (Number.isFinite(length)) recordDownloadBytes(length);
    });
    next();
  });

  const limiters = createRateLimiters({
    onAlert: (info) => services.events.emit('security.alert', info),
    securityEnabled: services.settings.get('security.lockEnabled'),
    loginLimit: services.settings.get('security.ipLoginLimit'),
    loginWindowMs: services.settings.get('security.ipWindowMinutes') * 60_000,
  });
  const requireUser = createRequireUser(services.auth);
  const csrf = createCsrfProtection(services.audit);

  app.use('/health', createHealthRouter({ db: services.db, version: options.version }));

  app.use('/api', limiters.api);

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
        allow_user_extract: services.settings.get('allow_user_extract'),
        allow_user_scan: services.settings.get('allow_user_scan'),
      },
      scan_enabled: services.settings.get('scan.enabled'),
      ai_enabled: services.settings.get('ai.enabled'),
      ai_mode: services.settings.get('ai.mode'),
      hosting_enabled: services.settings.get('hosting.enabled'),
      hosting_base_url: services.settings.get('hosting.base_url'),
    });
  });

  app.use('/api/hosting', requireUser, createHostingApiRouter(services, { csrf }));
  app.use('/host', createHostingSiteRouter(services));

  app.use('/api/ai', requireUser, createAiRouter(services, { csrf }));

  app.get('/api/public/plugin-theme.css', (_req, res) => {
    res.type('text/css').send(services.plugins.getThemeCss());
  });

  app.use(
    '/api/plugins',
    requireUser,
    createPluginsRouter(services, { csrf }),
  );

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

  app.use(
    '/api/shares',
    requireUser,
    createSharesRouter(services, {
      csrf,
      shareLimiter: limiters.shares,
    }),
  );

  app.use(
    '/api/auth',
    createAuthRouter(services, {
      requireUser,
      csrf,
      loginLimiter: limiters.login,
      registerLimiter: limiters.register,
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
    }),
  );
  app.use('/api/tasks', requireUser, createTasksRouter(services));

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

      const override = services.plugins.getWebOverride();
      if (override !== null) {
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
