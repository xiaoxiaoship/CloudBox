import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CloudboxApi, type Result } from '../shared/ipcTypes.ts';

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Result<T>>;
}

contextBridge.exposeInMainWorld('cloudboxTheme', {
  current: (): 'light' | 'dark' => (ipcRenderer.sendSync(IPC.systemThemeGet) as 'light' | 'dark') ?? 'light',
  subscribe: (callback: (theme: 'light' | 'dark') => void): (() => void) => {
    const listener = (_event: unknown, theme: 'light' | 'dark'): void => callback(theme);
    ipcRenderer.on(IPC.systemThemeChanged, listener);
    return () => ipcRenderer.removeListener(IPC.systemThemeChanged, listener);
  },
});

/**
 * 只通过 contextBridge 暴露白名单方法，渲染层拿不到 ipcRenderer 本身，
 * 也无法执行任意通道调用。
 */
const api: CloudboxApi = {
  auth: {
    status: () => invoke(IPC.authStatus),
    setup: (input) => invoke(IPC.authSetup, { username: input.username, password: input.password }),
    login: (input) => invoke(IPC.authLogin, input),
    logout: () => invoke(IPC.authLogout),
    changePassword: (input) => invoke(IPC.authChangePassword, input),
  },
  users: {
    list: () => invoke(IPC.usersList),
    create: (input) => invoke(IPC.usersCreate, input),
    setQuota: (input) => invoke(IPC.usersSetQuota, input),
    resetPassword: (input) => invoke(IPC.usersResetPassword, input),
    unlock: (input) => invoke(IPC.usersUnlock, input),
    setStatus: (input) => invoke(IPC.usersSetStatus, input),
    setSecurityMode: (input) => invoke(IPC.usersSetSecurityMode, input),
    clearRenameLimit: (input) => invoke(IPC.usersClearRenameLimit, input),
    ipHistory: (input) => invoke(IPC.usersIpHistory, input),
    remove: (input) => invoke(IPC.usersRemove, input),
    renameSelf: (input) => invoke(IPC.adminRenameSelf, input),
  },
  server: {
    status: () => invoke(IPC.serverStatus),
    setOnline: (input) => invoke(IPC.serverSetOnline, input),
    setAutoStart: (input) => invoke(IPC.serverSetAutoStart, input),
    getSchedule: () => invoke(IPC.serverGetSchedule),
    setSchedule: (input) => invoke(IPC.serverSetSchedule, input),
    setPort: (input) => invoke(IPC.serverSetPort, input),
    applyNetwork: (input) => invoke(IPC.serverApplyNetwork, input),
    certificate: () => invoke(IPC.serverCertificate),
    importCertificate: (input) => invoke(IPC.serverImportCertificate, input),
  },
  ca: {
    info: () => invoke(IPC.caInfo),
    create: () => invoke(IPC.caCreate),
    install: () => invoke(IPC.caInstall),
    uninstall: () => invoke(IPC.caUninstall),
    issueServerCert: (input) => invoke(IPC.caIssueServerCert, input),
    exportClientCert: () => invoke(IPC.caExportClientCert),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    setPublicRegistration: (input) => invoke(IPC.settingsSetPublicRegistration, input),
    setTrustProxy: (input) => invoke(IPC.settingsSetTrustProxy, input),
    setAdminWeb: (input) => invoke(IPC.settingsSetAdminWeb, input),
    setSecurity: (input) => invoke(IPC.settingsSetSecurity, input),
    setResources: (input) => invoke(IPC.settingsSetResources, input),
    setCacheCleanup: (input) => invoke(IPC.settingsSetCacheCleanup, input),
    setDefaultQuota: (input) => invoke(IPC.settingsSetDefaultQuota, input),
    setAddressMode: (input) => invoke(IPC.settingsSetAddressMode, input),
    resetDefaults: () => invoke(IPC.settingsResetDefaults),
    clearResourceCache: () => invoke(IPC.resourcesClearCache),
    setPermissions: (input) => invoke(IPC.settingsSetPermissions, input),
    setScan: (input) => invoke(IPC.settingsSetScan, input),
    setAi: (input) => invoke(IPC.settingsSetAi, input),
    setHosting: (input) => invoke(IPC.settingsSetHosting, input),
    setMail: (input) => invoke(IPC.settingsSetMail, input),
    testMail: () => invoke(IPC.settingsTestMail),
  },
  logs: {
    get: (input) => invoke(IPC.logsGet, input),
    export: (input) => invoke(IPC.logsExport, input),
    clear: () => invoke(IPC.logsClear),
  },
  announcements: {
    list: () => invoke(IPC.announcementsList),
    create: (input) => invoke(IPC.announcementsCreate, input),
    delete: (id) => invoke(IPC.announcementsDelete, id),
  },
  system: {
    checkUpdate: () => invoke(IPC.systemCheckUpdate),
    updateStatus: () => invoke(IPC.systemUpdateStatus),
    downloadUpdate: () => invoke(IPC.systemDownloadUpdate),
    installUpdate: () => invoke(IPC.systemInstallUpdate),
    openExternal: (input) => invoke(IPC.systemOpenExternal, input),
    rateLimits: () => invoke(IPC.systemRateLimits),
    clearRateLimit: (input) => invoke(IPC.systemClearRateLimit, input),
    securityBans: () => invoke(IPC.systemSecurityBans),
    clearSecurityBan: (input) => invoke(IPC.systemClearSecurityBan, input),
    clearAllSecurityBans: () => invoke(IPC.systemClearAllSecurityBans),
    taskUsage: () => invoke(IPC.systemTaskUsage),
    securityCounts: () => invoke(IPC.systemSecurityCounts),
    clearSecurityCount: (input) => invoke(IPC.systemClearSecurityCount, input),
    clearAllSecurityCounts: () => invoke(IPC.systemClearAllSecurityCounts),
  },
  frp: {
    status: () => invoke(IPC.frpStatus),
    saveConfig: (input) => invoke(IPC.frpSaveConfig, input),
    start: () => invoke(IPC.frpStart),
    stop: () => invoke(IPC.frpStop),
    restart: () => invoke(IPC.frpRestart),
    getSync: () => invoke(IPC.frpGetSync),
    setSync: (input) => invoke(IPC.frpSetSync, input),
  },
  files: {
    list: (input) => invoke(IPC.filesList, input),
    download: (input) => invoke(IPC.filesDownload, input),
  },
  app: {
    info: () => invoke(IPC.appInfo),
    openDataDir: () => invoke(IPC.appOpenDataDir),
    openStorageDir: () => invoke(IPC.appOpenStorageDir),
    openPluginsDir: () => invoke(IPC.appOpenPluginsDir),
    backupDatabase: () => invoke(IPC.appBackupDatabase),
    chooseDirectory: (input) => invoke(IPC.appChooseDirectory, input),
    changeDirectory: (input) => invoke(IPC.appChangeDirectory, input),
    getStartup: () => invoke(IPC.appGetStartup),
    setStartup: (input) => invoke(IPC.appSetStartup, input),
  },
  plugins: {
    list: () => invoke(IPC.pluginsList),
    import: () => invoke(IPC.pluginsImport),
    setEnabled: (input) => invoke(IPC.pluginsSetEnabled, input),
    setAllowWebOverride: (input) => invoke(IPC.pluginsSetAllowWebOverride, input),
    remove: (input) => invoke(IPC.pluginsRemove, input),
    openAdmin: (input) => invoke(IPC.pluginsOpenAdmin, input),
  },
};

contextBridge.exposeInMainWorld('cloudbox', api);
