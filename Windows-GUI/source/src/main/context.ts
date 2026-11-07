import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { createCoreServices, type CoreServices } from '../core/container.ts';
import { closeDatabase, openDatabase } from '../core/db/connection.ts';
import { migrate } from '../core/db/migrator.ts';
import { AdminUserService } from '../core/services/adminUserService.ts';
import { AdminSession } from './adminSession.ts';
import { CaManager } from './caManager.ts';
import { FrpService } from './frpService.ts';
import { loadAppPaths } from './pathConfig.ts';
import { ServerController } from './serverController.ts';
import { TlsManager } from './tlsManager.ts';

export interface MainContext {
  services: CoreServices;
  adminUsers: AdminUserService;
  session: AdminSession;
  server: ServerController;
  tls: TlsManager;
  ca: CaManager;
  frp: FrpService;
  version: string;
  dataDir: string;
  storageRoot: string;
  pluginsDir: string;
  tempDir: string;
  adminDist: string;
  webDist: string;
}

/**
 * 初始化 Electron 主进程的领域容器。
 * 数据目录默认 %APPDATA%/CloudBox；E2E 可用 CLOUDBOX_DATA_DIR 覆盖。
 */
export function createMainContext(): MainContext {
  const paths = loadAppPaths();
  const dataDir = paths.dataDir;
  const storageRoot = paths.storageDir;
  const pluginsDir = paths.pluginsDir;
  const tempDir = path.join(dataDir, 'tmp', 'uploads');

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  mkdirSync(pluginsDir, { recursive: true });
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const db = openDatabase({ file: path.join(dataDir, 'cloudbox.db') });
  migrate(db, path.join(app.getAppPath(), 'dist', 'main', 'migrations'));

  const services = createCoreServices({
    db,
    storageRoot,
    tempDir,
    pluginRoot: pluginsDir,
    pluginChildScript: app.isPackaged
      ? path.join(process.resourcesPath, 'bin', 'plugin-child.cjs')
      : path.join(app.getAppPath(), 'dist', 'main', 'plugin-child.cjs'),
    pluginExecPath: process.execPath,
    secretPath: path.join(dataDir, 'ai-secret.key'),
    secretLegacyPath: path.join(storageRoot, '.ai-secret'),
  });

  const adminUsers = new AdminUserService({
    db,
    users: services.users,
    quotas: services.quotas,
    sessions: services.sessions,
    auth: services.auth,
    audit: services.audit,
    storageRoot,
  });

  const session = new AdminSession(services.auth);
  const tls = new TlsManager(dataDir);
  const ca = new CaManager({ dataDir, tls, settings: services.settings });

  // “在线模式”只是运行时状态：每次启动都从离线开始，只有显式打开才监听端口。
  const configuredPort = services.settings.get('server.port');
  const httpsEnabled = services.settings.get('server.httpsEnabled');
  const mtlsEnabled = services.settings.get('server.mtlsEnabled');
  services.settings.set('server.online', false, null);

  let serverRef: ServerController | null = null;

  const server = new ServerController({
    services,
    version: app.getVersion(),
    webDist: path.join(app.getAppPath(), 'dist', 'web'),
    port: configuredPort,
    httpsEnabled,
    mtlsEnabled,
    getTlsOptions: () => tls.getOptions(),
    getMtlsCa: () => ca.getCACertBuffer(),
    getRootCaPath: () => (ca.getCAInfo().exists ? ca.caCertPath : null),
  });
  serverRef = server;

  const frp = new FrpService({
    dataDir,
    config: {
      serverAddr: services.settings.get('frp.serverAddr'),
      serverPort: services.settings.get('frp.serverPort'),
      remotePort: services.settings.get('frp.remotePort'),
      token: services.settings.get('frp.token'),
      user: services.settings.get('frp.user'),
      proxyName: services.settings.get('frp.proxyName'),
      tunnelType: services.settings.get('frp.tunnelType'),
      customDomain: services.settings.get('frp.customDomain'),
      proxyProtocol: services.settings.get('frp.proxyProtocol'),
    },
    getLocalPort: () => serverRef?.getStatus().port ?? configuredPort,
    getProtocol: () => serverRef?.getStatus().protocol ?? (httpsEnabled ? 'https' : 'http'),
  });

  return {
    services,
    adminUsers,
    session,
    server,
    tls,
    ca,
    frp,
    version: app.getVersion(),
    dataDir,
    storageRoot,
    pluginsDir,
    tempDir,
    adminDist: path.join(app.getAppPath(), 'dist', 'admin'),
    webDist: path.join(app.getAppPath(), 'dist', 'web'),
  };
}

export function disposeMainContext(context: MainContext): void {
  closeDatabase(context.services.db);
}
