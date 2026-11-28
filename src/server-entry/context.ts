import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { closeDatabase, openDatabase } from '../core/db/connection.ts';
import { migrate } from '../core/db/migrator.ts';
import { createCoreServices, type CoreServices } from '../core/container.ts';
import { getAppVersion } from '../shared/version.ts';
import { ADMIN_WEB_PORT } from '../shared/admin.ts';
import { AdminSessionRepository } from '../core/db/repositories/adminSessionRepo.ts';
import { AdminAuthService } from '../core/services/admin/adminAuthService.ts';
import { AdminUserService } from '../core/services/admin/adminUserService.ts';
import { InitTokenService } from './initToken.ts';
import { TlsManager } from '../main/tlsManager.ts';
import { ServerController } from '../main/serverController.ts';
import { FrpService } from '../main/frpService.ts';
import { CaManager } from '../main/caManager.ts';
import { ServiceAutomation } from '../main/serviceAutomation.ts';
import { clearResourceCache } from '../core/services/cacheCleanupService.ts';
import { loadHeadlessPaths } from './paths.ts';

export { ADMIN_WEB_PORT } from '../shared/admin.ts';

export interface HeadlessContext {
  services: CoreServices;
  version: string;
  dataDir: string;
  storageRoot: string;
  pluginsDir: string;
  tempDir: string;
  adminDist: string;
  webDist: string;
  tls: TlsManager;
  ca: CaManager;
  frp: FrpService;
  automation: ServiceAutomation;
  userServer: ServerController;
  adminUsers: AdminUserService;
  adminAuth: AdminAuthService;
  initToken: InitTokenService;
}

export function defaultDataDir(): string {
  return loadHeadlessPaths().dataDir;
}

export function createHeadlessContext(): HeadlessContext {
  const paths = loadHeadlessPaths();
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
  const bundledMigrations = path.join(process.cwd(), 'dist', 'headless', 'migrations');
  migrate(db, existsSync(bundledMigrations) ? bundledMigrations : path.resolve('src/core/db/migrations'));
  const pluginChildScript = existsSync(path.resolve('dist/main/plugin-child.cjs'))
    ? path.resolve('dist/main/plugin-child.cjs')
    : path.resolve('src/plugin-runtime/child.cjs');

  const services = createCoreServices({
    db,
    storageRoot,
    tempDir,
    pluginRoot: pluginsDir,
    pluginChildScript,
    pluginExecPath: process.execPath,
    secretPath: path.join(dataDir, 'ai-secret.key'),
    secretLegacyPath: path.join(storageRoot, '.ai-secret'),
  });

  const version = getAppVersion();
  const adminUsers = new AdminUserService({
    db,
    users: services.users,
    quotas: services.quotas,
    sessions: services.sessions,
    auth: services.auth,
    audit: services.audit,
    settings: services.settings,
    loginIps: services.loginIps,
    storageRoot,
  });
  const adminAuth = new AdminAuthService({
    users: services.users,
    sessions: new AdminSessionRepository(db),
    adminUsers,
    settings: services.settings,
    audit: services.audit,
  });
  const initToken = new InitTokenService(dataDir, services.settings);
  const tls = new TlsManager(dataDir);
  const ca = new CaManager({ dataDir, tls, settings: services.settings, isPackaged: false, appPath: process.cwd() });
  const userServer = new ServerController({
    services,
    version,
    webDist: path.resolve('dist/web'),
    port: services.settings.get('server.port'),
    bind: services.settings.get('server.bind'),
    httpsEnabled: services.settings.get('server.httpsEnabled'),
    mtlsEnabled: services.settings.get('server.mtlsEnabled'),
    getTlsOptions: () => tls.getOptions(),
    getMtlsCa: () => ca.getCACertBuffer(),
    getRootCaPath: () => (ca.getCAInfo().exists ? ca.caCertPath : null),
    isProxyProtocolEnabled: () => services.settings.get('frp.proxyProtocol'),
    proxyTimeoutMs: services.settings.getLowLevel().proxyTimeoutMs,
    tlsMinVersion: services.settings.getLowLevel().tlsMinVersion,
    headersTimeoutMs: services.settings.getLowLevel().headersTimeoutMs,
    requestTimeoutMs: services.settings.getLowLevel().requestTimeoutMs,
  });

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
      healthCheckMux: services.settings.get('frp.healthCheckMux'),
    },
    getLocalPort: () => userServer.getStatus().port,
    getProtocol: () => userServer.getStatus().protocol,
    healthCheckTimeoutSeconds: services.settings.getLowLevel().frpHealthTimeoutSeconds,
    healthCheckIntervalSeconds: services.settings.getLowLevel().frpHealthIntervalSeconds,
  });

  const automation = new ServiceAutomation({
    server: userServer,
    frp,
    settings: services.settings,
    cleanupCache: () => clearResourceCache(services),
  });

  return {
    services,
    version,
    dataDir,
    storageRoot,
    pluginsDir,
    tempDir,
    adminDist: path.resolve('dist/admin'),
    webDist: path.resolve('dist/web'),
    tls,
    ca,
    frp,
    automation,
    userServer,
    adminUsers,
    adminAuth,
    initToken,
  };
}

export function disposeHeadlessContext(context: HeadlessContext): void {
  context.automation.dispose();
  closeDatabase(context.services.db);
}
