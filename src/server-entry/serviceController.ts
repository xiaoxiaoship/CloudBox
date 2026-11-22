import type { Server } from 'node:http';
import type { Express } from 'express';
import { createAdminApp } from '../admin-server/app.ts';
import { AdminServerService, type AdminServerRuntime } from '../core/services/admin/adminServerService.ts';
import { AdminFrpService } from '../core/services/admin/adminFrpService.ts';
import { AdminCaService } from '../core/services/admin/adminCaService.ts';
import { AdminDirectoryService } from '../core/services/admin/adminDirectoryService.ts';
import { UpdateManager } from '../core/services/updateManager.ts';
import { scheduleServerUpdate } from './updateInstaller.ts';
import path from 'node:path';
import { isPortAvailable, type ServerController } from '../main/serverController.ts';
import { logger } from '../shared/logger.ts';
import {
  ADMIN_WEB_PORT,
  createHeadlessContext,
  disposeHeadlessContext,
  type HeadlessContext,
} from './context.ts';

export class HeadlessServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HeadlessServiceError';
    this.code = code;
  }
}

export interface HeadlessStatus {
  adminRunning: boolean;
  adminPort: number;
  userRunning: boolean;
  userPort: number;
  protocol: 'http' | 'https';
}

export class ServiceController implements AdminServerRuntime {
  private readonly context: HeadlessContext;
  private readonly adminPort: number;
  private adminServer: Server | null = null;
  private adminApp: Express | null = null;
  private readonly adminServerService: AdminServerService;
  private readonly adminFrpService: AdminFrpService;
  private readonly adminCaService: AdminCaService;
  private readonly adminDirectoryService: AdminDirectoryService;
  private readonly updateManager: UpdateManager;
  private sessionCleanupTimer: NodeJS.Timeout | null = null;

  constructor(context: HeadlessContext, options: { adminPort?: number } = {}) {
    this.context = context;
    this.adminPort = options.adminPort ?? ADMIN_WEB_PORT;
    this.adminServerService = new AdminServerService({ settings: context.services.settings, runtime: this });
    this.adminFrpService = new AdminFrpService({ frp: context.frp, settings: context.services.settings });
    this.adminCaService = new AdminCaService({ ca: context.ca, tls: context.tls });
    this.updateManager = new UpdateManager({
      update: context.services.update,
      currentVersion: context.version,
      mode: 'server',
      downloadDir: path.join(context.dataDir, 'tmp', 'updates'),
      install: async (installerPath) => {
        scheduleServerUpdate({ installerPath, tempDir: path.join(context.dataDir, 'tmp', 'updates') });
        setTimeout(() => { void this.close().finally(() => process.exit(0)); }, 1_200).unref();
      },
    });
    this.adminDirectoryService = new AdminDirectoryService({
      services: context.services,
      audit: context.services.audit,
      paths: { dataDir: context.dataDir, storageDir: context.storageRoot, pluginsDir: context.pluginsDir },
      runtime: {
        stopUser: () => this.stopUser(),
        startUser: () => this.startUser(),
        getUserRunning: () => this.context.userServer.getStatus().running,
        restartProcess: () => { void this.close().finally(() => process.exit(1)); },
      },
    });
  }

  getAdminPort(): number { return this.adminPort; }

  getUserStatus() { return this.context.userServer.getStatus(); }

  configureHttps(enabled: boolean): void { this.context.userServer.configureHttps(enabled); }

  configureMtls(enabled: boolean): void { this.context.userServer.configureMtls(enabled); }

  getSchedule() { return this.context.automation.getSchedule(); }

  setSchedule(input: { enabled: boolean; start: string; end: string }) {
    this.context.services.settings.set('server.scheduleEnabled', input.enabled, null);
    this.context.services.settings.set('server.scheduleStart', input.start, null);
    this.context.services.settings.set('server.scheduleEnd', input.end, null);
    return this.context.automation.getSchedule();
  }

  get userServer(): ServerController {
    return this.context.userServer;
  }

  get services(): HeadlessContext['services'] {
    return this.context.services;
  }

  get adminHttpApp(): Express | null {
    return this.adminApp;
  }

  /** Startup order: admin first, then user Web, then optional frpc. */
  async start(): Promise<void> {
    await this.startAdmin();
    if (this.context.services.settings.get('server.online')) {
      await this.startUser();
    } else {
      logger.info('用户 Web 处于离线模式；可在管理端开启在线模式');
    }
    if (this.context.services.settings.get('frp.enabled')) {
      try {
        await this.context.frp.start();
        logger.info('frpc 已启动');
      } catch (error) {
        logger.warn('frpc 启动失败，管理 Web 仍保持可用', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async startAdmin(): Promise<void> {
    if (this.adminServer !== null) return;

    const userPort = this.context.services.settings.get('server.port');
    if (this.adminPort === userPort) {
      throw new HeadlessServiceError(
        'ADMIN_PORT_CONFLICT',
        `管理端端口 ${this.adminPort} 不能与用户 Web 端口相同`,
      );
    }

    if (!(await isPortAvailable(this.adminPort, '0.0.0.0'))) {
      throw new HeadlessServiceError(
        'ADMIN_PORT_IN_USE',
        `管理端端口 ${this.adminPort} 已被占用，进程将退出`,
      );
    }

    const init = this.context.initToken.ensure(this.context.adminAuth.needsSetup(), this.adminPort);
    if (init.required) {
      if (init.token !== null) {
        logger.warn(`首次初始化 URL（24 小时内有效）：${init.url}`);
      } else {
        logger.warn(`初始化 token 已存在但无法再次显示；如需重新生成，请删除 ${this.context.initToken.path} 后重启服务`);
      }
    }

    this.adminApp = createAdminApp({
      services: this.context.services,
      version: this.context.version,
      adminAuth: this.context.adminAuth,
      adminUsers: this.context.adminUsers,
      serviceController: this,
      adminServer: this.adminServerService,
      adminFrp: this.adminFrpService,
      adminCa: this.adminCaService,
      initToken: this.context.initToken,
      adminDist: this.context.adminDist,
      appInfo: {
        dataDir: this.context.dataDir,
        storageDir: this.context.storageRoot,
        pluginsDir: this.context.pluginsDir,
      },
      adminDirectory: this.adminDirectoryService,
      updateManager: this.updateManager,
    });

    const server = await new Promise<Server>((resolve, reject) => {
      const instance = this.adminApp!.listen(this.adminPort, '0.0.0.0');
      instance.once('listening', () => resolve(instance));
      instance.once('error', (error: NodeJS.ErrnoException) => {
        instance.close();
        if (error.code === 'EADDRINUSE') {
          reject(new HeadlessServiceError(
            'ADMIN_PORT_IN_USE',
            `管理端端口 ${this.adminPort} 已被占用，进程将退出`,
          ));
          return;
        }
        reject(error);
      });
    });

    this.adminServer = server;
    this.context.adminAuth.deleteExpired();
    this.sessionCleanupTimer = setInterval(() => {
      this.context.adminAuth.deleteExpired();
    }, 60 * 60_000);
    this.sessionCleanupTimer.unref();
    logger.info(`管理端 Web 已启动：http://0.0.0.0:${this.adminPort}/api/admin/health`);
  }

  async startUser(): Promise<void> {
    const port = this.context.services.settings.get('server.port');
    if (port === this.adminPort) {
      throw new HeadlessServiceError(
        'USER_PORT_CONFLICT',
        `用户 Web 端口 ${port} 不能与管理端端口相同`,
      );
    }
    await this.context.userServer.start(port);
    this.context.services.settings.set('server.online', true, null);
    logger.info(`用户 Web 已启动：端口 ${port}`);
  }

  async stopUser(): Promise<void> {
    await this.context.userServer.stop();
    this.context.services.settings.set('server.online', false, null);
  }

  async restartUser(): Promise<void> {
    await this.stopUser();
    await this.startUser();
  }

  getStatus(): HeadlessStatus {
    const user = this.context.userServer.getStatus();
    return {
      adminRunning: this.adminServer !== null,
      adminPort: this.adminPort,
      userRunning: user.running,
      userPort: user.port,
      protocol: user.protocol,
    };
  }

  async close(): Promise<void> {
    await this.context.frp.stop().catch(() => {});
    if (this.sessionCleanupTimer !== null) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }
    await this.context.userServer.stop().catch(() => {});
    const server = this.adminServer;
    this.adminServer = null;
    this.adminApp = null;
    if (server !== null) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 1_000).unref?.();
      });
    }
    disposeHeadlessContext(this.context);
  }
}

export function createHeadlessController(options: { adminPort?: number } = {}): ServiceController {
  return new ServiceController(createHeadlessContext(), options);
}
