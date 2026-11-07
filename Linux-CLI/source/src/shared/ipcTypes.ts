/** 主进程 <-> 预加载 <-> 管理员渲染层共享的 IPC 契约（仅类型 + 通道常量） */

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
}

export interface UserSummary extends AdminUser {
  quotaBytes: number | null;
  usedBytes: number;
  failedAttempts: number;
  lockedUntil: number | null;
}

export interface AdminStatus {
  needsSetup: boolean;
  authenticated: boolean;
  user: AdminUser | null;
  version: string;
  dataDir: string;
  storageDir: string;
  pluginsDir: string;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  running: boolean;
  allowWebOverride: boolean;
  hasAdminUi: boolean;
  hasTheme: boolean;
  hasWebOverride: boolean;
  adminUiUrl: string | null;
  directory: string;
}

export interface CertificateInfo {
  configured: boolean;
  certFileName: string | null;
  keyFileName: string | null;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  error: string | null;
}

export interface CaInfo {
  exists: boolean;
  caDir: string;
  certFileName: string | null;
  keyFileName: string | null;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  installed: boolean;
  error: string | null;
}

export interface ClientCertExport {
  saved: boolean;
  fileName?: string;
  password?: string;
}

export interface AdminSettings {
  allowPublicRegistration: boolean;
  trustProxy: boolean;
  permissions: {
    allowUserPreviewImage: boolean;
    allowUserPreviewVideo: boolean;
    allowUserPreviewPdf: boolean;
    allowUserExtract: boolean;
    allowUserScan: boolean;
  };
  scan: {
    enabled: boolean;
    mode: 'api' | 'local';
    apiKey: string;
    localPath: string;
  };
  ai: {
    enabled: boolean;
    mode: 'admin' | 'user';
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    dailyLimit: number;
  };
  hosting: {
    enabled: boolean;
    baseUrl: string;
  };
  mail: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    from: string;
    to: string;
    hasPass: boolean;
    passMasked: string;
    events: {
      userRegistered: boolean;
      securityAlert: boolean;
      systemError: boolean;
    };
  };
}

export interface FeaturePermissions {
  allowUserPreviewImage: boolean;
  allowUserPreviewVideo: boolean;
  allowUserPreviewPdf: boolean;
  allowUserExtract: boolean;
  allowUserScan: boolean;
}

export interface ScanConfig {
  enabled: boolean;
  mode: 'api' | 'local';
  apiKey: string;
  localPath: string;
}

export interface ServerStatus {
  running: boolean;
  port: number;
  bind: string;
  protocol: 'http' | 'https';
  httpsEnabled: boolean;
  mtlsEnabled: boolean;
  certificate: CertificateInfo;
  urls: string[];
  lanIps: string[];
  startedAt: number | null;
  error: string | null;
}

export interface FrpConfig {
  serverAddr: string;
  serverPort: number;
  remotePort: number;
  token: string;
  proxyName: string;
  tunnelType: 'tcp' | 'http' | 'https';
  customDomain: string;
  proxyProtocol: boolean;
}

export interface FrpStatus {
  available: boolean;
  binaryPath: string | null;
  running: boolean;
  pid: number | null;
  config: FrpConfig;
  configPath: string;
  logs: string[];
  error: string | null;
}

export interface FileEntryDto {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number | null;
  modifiedAt: number;
}

export interface FileListingDto {
  path: string;
  parent: string | null;
  entries: FileEntryDto[];
  truncated: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface CloudboxApi {
  auth: {
    status: () => Promise<Result<AdminStatus>>;
    setup: (input: { username: string; password: string }) => Promise<Result<AdminUser>>;
    login: (input: { username: string; password: string }) => Promise<Result<AdminUser>>;
    logout: () => Promise<Result<null>>;
    changePassword: (input: {
      currentPassword: string;
      newPassword: string;
    }) => Promise<Result<null>>;
  };
  users: {
    list: () => Promise<Result<UserSummary[]>>;
    create: (input: {
      username: string;
      password: string;
      quotaBytes: number | null;
    }) => Promise<Result<UserSummary>>;
    setQuota: (input: { userId: number; quotaBytes: number | null }) => Promise<Result<null>>;
    resetPassword: (input: { userId: number; newPassword: string }) => Promise<Result<null>>;
    unlock: (input: { userId: number }) => Promise<Result<null>>;
    setStatus: (input: {
      userId: number;
      status: UserStatus;
    }) => Promise<Result<null>>;
    remove: (input: { userId: number; deleteFiles: boolean }) => Promise<Result<null>>;
  };
  server: {
    status: () => Promise<Result<ServerStatus>>;
    setOnline: (input: { enabled: boolean }) => Promise<Result<ServerStatus>>;
    setPort: (input: { port: number }) => Promise<Result<ServerStatus>>;
    applyNetwork: (input: {
      protocol: 'http' | 'https';
      port: number;
      mtlsEnabled?: boolean;
    }) => Promise<Result<ServerStatus>>;
    certificate: () => Promise<Result<CertificateInfo>>;
    importCertificate: (input: {
      kind: 'cert' | 'key';
    }) => Promise<Result<{ imported: boolean; certificate: CertificateInfo }>>;
  };
  ca: {
    info: () => Promise<Result<CaInfo>>;
    create: () => Promise<Result<CaInfo>>;
    install: () => Promise<Result<CaInfo>>;
    uninstall: () => Promise<Result<CaInfo>>;
    issueServerCert: () => Promise<Result<CertificateInfo>>;
    exportClientCert: () => Promise<Result<ClientCertExport>>;
  };
  settings: {
    get: () => Promise<Result<AdminSettings>>;
    setPublicRegistration: (
      input: { enabled: boolean },
    ) => Promise<Result<AdminSettings>>;
    setTrustProxy: (input: { enabled: boolean }) => Promise<Result<AdminSettings>>;
    setPermissions: (input: FeaturePermissions) => Promise<Result<AdminSettings>>;
    setScan: (input: ScanConfig) => Promise<Result<AdminSettings>>;
    setAi: (input: {
      enabled: boolean;
      mode: 'admin' | 'user';
      baseUrl: string;
      apiKey?: string;
      model: string;
      dailyLimit: number;
    }) => Promise<Result<AdminSettings>>;
    setHosting: (input: { enabled: boolean; baseUrl: string }) => Promise<Result<AdminSettings>>;
    setMail: (input: {
      enabled: boolean;
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass?: string;
      from: string;
      to: string;
      eventUserRegistered: boolean;
      eventSecurityAlert: boolean;
      eventSystemError: boolean;
    }) => Promise<Result<AdminSettings>>;
    testMail: () => Promise<Result<{ ok: boolean; message: string }>>;
  };
  frp: {
    status: () => Promise<Result<FrpStatus>>;
    saveConfig: (input: FrpConfig) => Promise<Result<FrpStatus>>;
    start: () => Promise<Result<FrpStatus>>;
    stop: () => Promise<Result<FrpStatus>>;
    restart: () => Promise<Result<FrpStatus>>;
  };
  files: {
    list: (input: { userId: number; path: string }) => Promise<Result<FileListingDto>>;
    download: (input: {
      userId: number;
      path: string;
    }) => Promise<Result<{ saved: boolean; fileName?: string }>>;
  };
  app: {
    info: () => Promise<Result<{ version: string; dataDir: string; storageDir: string; pluginsDir: string }>>;
    openDataDir: () => Promise<Result<null>>;
    backupDatabase: () => Promise<Result<{ saved: boolean; fileName?: string }>>;
    chooseDirectory: (input: {
      kind: 'data' | 'storage' | 'plugins';
    }) => Promise<Result<{ selected: boolean; path?: string }>>;
    changeDirectory: (input: {
      kind: 'data' | 'storage' | 'plugins';
      targetPath: string;
      migrate: boolean;
    }) => Promise<Result<{ restarting: boolean }>>;
  };
  plugins: {
    list: () => Promise<Result<PluginInfo[]>>;
    import: () => Promise<Result<PluginInfo[] | null>>;
    setEnabled: (input: { name: string; enabled: boolean }) => Promise<Result<PluginInfo[]>>;
    setAllowWebOverride: (input: {
      name: string;
      allowed: boolean;
    }) => Promise<Result<PluginInfo[]>>;
    remove: (input: { name: string }) => Promise<Result<PluginInfo[]>>;
  };
}

export const IPC = {
  authStatus: 'auth:status',
  authSetup: 'auth:setup',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authChangePassword: 'auth:change-password',

  usersList: 'users:list',
  usersCreate: 'users:create',
  usersSetQuota: 'users:set-quota',
  usersResetPassword: 'users:reset-password',
  usersUnlock: 'users:unlock',
  usersSetStatus: 'users:set-status',
  usersRemove: 'users:remove',

  serverStatus: 'server:status',
  serverSetOnline: 'server:set-online',
  serverSetPort: 'server:set-port',
  serverApplyNetwork: 'server:apply-network',
  serverCertificate: 'server:certificate',
  serverImportCertificate: 'server:import-certificate',

  caInfo: 'ca:info',
  caCreate: 'ca:create',
  caInstall: 'ca:install',
  caUninstall: 'ca:uninstall',
  caIssueServerCert: 'ca:issue-server-cert',
  caExportClientCert: 'ca:export-client-cert',

  settingsGet: 'settings:get',
  settingsSetPublicRegistration: 'settings:set-public-registration',
  settingsSetTrustProxy: 'settings:set-trust-proxy',
  settingsSetPermissions: 'settings:set-permissions',
  settingsSetScan: 'settings:set-scan',
  settingsSetAi: 'settings:set-ai',
  settingsSetHosting: 'settings:set-hosting',
  settingsSetMail: 'settings:set-mail',
  settingsTestMail: 'settings:test-mail',

  frpStatus: 'frp:status',
  frpSaveConfig: 'frp:save-config',
  frpStart: 'frp:start',
  frpStop: 'frp:stop',
  frpRestart: 'frp:restart',

  filesList: 'files:list',
  filesDownload: 'files:download',

  appInfo: 'app:info',
  appOpenDataDir: 'app:open-data-dir',
  appBackupDatabase: 'app:backup-database',
  appChooseDirectory: 'app:choose-directory',
  appChangeDirectory: 'app:change-directory',
  pluginsList: 'plugins:list',
  pluginsImport: 'plugins:import',
  pluginsSetEnabled: 'plugins:set-enabled',
  pluginsSetAllowWebOverride: 'plugins:set-allow-web-override',
  pluginsRemove: 'plugins:remove',
} as const;
