import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { CoreServices } from '../core/container.ts';
import type { AdminAuthService } from '../core/services/admin/adminAuthService.ts';
import type { InitTokenService } from '../server-entry/initToken.ts';
import { createIntranetOnly } from './middleware/intranetOnly.ts';
import { createAdminCsrf, createRequireAdmin } from './middleware/adminAuth.ts';
import { createAdminAuthRouter } from './routes/auth.routes.ts';
import { createAdminWriteAudit } from './middleware/adminAudit.ts';
import { createAdminUsersRouter } from './routes/users.routes.ts';
import { createAdminServerRouter } from './routes/server.routes.ts';
import { createAdminSettingsRouter } from './routes/settings.routes.ts';
import { createAdminSystemRouter } from './routes/system.routes.ts';
import { createAdminFilesRouter } from './routes/files.routes.ts';
import { createAdminPluginsRouter } from './routes/plugins.routes.ts';
import { createAdminFrpRouter } from './routes/frp.routes.ts';
import { createAdminCaRouter } from './routes/ca.routes.ts';
import { createAdminAppRouter } from './routes/app.routes.ts';
import type { AdminFrpService } from '../core/services/admin/adminFrpService.ts';
import type { AdminCaService } from '../core/services/admin/adminCaService.ts';
import type { AdminUserService } from '../core/services/admin/adminUserService.ts';
import type { AdminDirectoryService } from '../core/services/admin/adminDirectoryService.ts';
import type { ServiceController } from '../server-entry/serviceController.ts';
import type { AdminServerService } from '../core/services/admin/adminServerService.ts';

export interface AdminAppOptions {
  services: CoreServices;
  version: string;
  adminAuth?: AdminAuthService;
  initToken?: InitTokenService;
  adminUsers?: AdminUserService;
  serviceController?: ServiceController;
  adminServer?: AdminServerService;
  adminFrp?: AdminFrpService;
  adminCa?: AdminCaService;
  adminDist?: string;
  appInfo?: { dataDir: string; storageDir: string; pluginsDir: string };
  adminDirectory?: AdminDirectoryService;
}

/**
 * 独立的 headless 管理端 Express 应用。
 * 不共享用户 Web 的 session/csrf/CSP；Phase 1 只提供健康检查。
 */
export function createAdminApp(options: AdminAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(createIntranetOnly(options.services.settings, options.services.audit));

  if (options.adminAuth !== undefined && options.initToken !== undefined) {
    const csrf = createAdminCsrf(options.services.audit);
    const requireAdmin = createRequireAdmin(options.adminAuth);
    app.get('/api/admin/app/info', requireAdmin, (_req, res) => {
      res.json({
        version: options.version,
        dataDir: options.appInfo?.dataDir ?? '',
        storageDir: options.appInfo?.storageDir ?? '',
        pluginsDir: options.appInfo?.pluginsDir ?? '',
        isPackaged: true,
        isPortable: false,
      });
    });
    app.use('/api/admin', createAdminAuthRouter(options.adminAuth, options.initToken, csrf));
    app.use('/api/admin', createAdminWriteAudit(options.services.audit));
    if (options.adminUsers !== undefined) {
      const requireAdmin = createRequireAdmin(options.adminAuth);
      app.use('/api/admin/users', requireAdmin, createAdminUsersRouter(options.adminUsers, csrf));
    }
    if (options.adminServer !== undefined) {
      const requireAdmin = createRequireAdmin(options.adminAuth);
      app.use('/api/admin/server', requireAdmin, createAdminServerRouter(options.adminServer, csrf));
    }
    {
      const requireAdmin = createRequireAdmin(options.adminAuth);
      app.use('/api/admin/settings', requireAdmin, createAdminSettingsRouter(options.services, csrf));
      app.use('/api/admin/system', requireAdmin, createAdminSystemRouter(options.services, options.version, csrf));
      app.use('/api/admin/files', requireAdmin, createAdminFilesRouter(options.services));
      app.use('/api/admin/plugins', requireAdmin, createAdminPluginsRouter(options.services, csrf));
      if (options.adminFrp !== undefined) {
        app.use('/api/admin/frp', requireAdmin, createAdminFrpRouter(options.adminFrp, csrf));
      }
      if (options.adminCa !== undefined) {
        app.use('/api/admin/ca', requireAdmin, createAdminCaRouter(options.adminCa, csrf));
      }
      if (options.appInfo !== undefined) {
        app.use('/api/admin/app', requireAdmin, createAdminAppRouter(options.services, options.appInfo.dataDir, options.adminDirectory!, csrf));
      }
    }
  }

  app.get('/api/admin/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'cloudbox-admin',
      version: options.version,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  if (options.adminDist !== undefined && existsSync(path.join(options.adminDist, 'index.html'))) {
    app.use(express.static(options.adminDist, { index: false }));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(options.adminDist!, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: '管理接口不存在' });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const record = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown; httpStatus?: unknown };
    const status = typeof record.httpStatus === 'number'
      ? record.httpStatus
      : record.name === 'ZodError' ? 400 : 500;
    res.status(status).json({
      code: typeof record.code === 'string' ? record.code : status === 400 ? 'INVALID_INPUT' : 'ADMIN_INTERNAL_ERROR',
      message: typeof record.message === 'string' ? record.message : '管理端操作失败',
    });
  });

  return app;
}
