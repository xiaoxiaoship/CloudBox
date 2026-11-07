import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CloudboxApi, type Result } from '../shared/ipcTypes.ts';

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Result<T>>;
}

/**
 * 只通过 contextBridge 暴露白名单方法，渲染层拿不到 ipcRenderer 本身，
 * 也无法执行任意通道调用。
 */
const api: CloudboxApi = {
  auth: {
    status: () => invoke(IPC.authStatus),
    setup: (input) => invoke(IPC.authSetup, input),
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
    remove: (input) => invoke(IPC.usersRemove, input),
  },
  server: {
    status: () => invoke(IPC.serverStatus),
    setOnline: (input) => invoke(IPC.serverSetOnline, input),
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
    issueServerCert: () => invoke(IPC.caIssueServerCert),
    exportClientCert: () => invoke(IPC.caExportClientCert),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    setPublicRegistration: (input) => invoke(IPC.settingsSetPublicRegistration, input),
    setTrustProxy: (input) => invoke(IPC.settingsSetTrustProxy, input),
    setPermissions: (input) => invoke(IPC.settingsSetPermissions, input),
    setScan: (input) => invoke(IPC.settingsSetScan, input),
    setAi: (input) => invoke(IPC.settingsSetAi, input),
    generateMcpToken: () => invoke(IPC.settingsGenerateMcpToken),
    setHosting: (input) => invoke(IPC.settingsSetHosting, input),
    setMail: (input) => invoke(IPC.settingsSetMail, input),
    testMail: () => invoke(IPC.settingsTestMail),
  },
  frp: {
    status: () => invoke(IPC.frpStatus),
    saveConfig: (input) => invoke(IPC.frpSaveConfig, input),
    start: () => invoke(IPC.frpStart),
    stop: () => invoke(IPC.frpStop),
    restart: () => invoke(IPC.frpRestart),
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
  },
  plugins: {
    list: () => invoke(IPC.pluginsList),
    import: () => invoke(IPC.pluginsImport),
    setEnabled: (input) => invoke(IPC.pluginsSetEnabled, input),
    setAllowWebOverride: (input) => invoke(IPC.pluginsSetAllowWebOverride, input),
    remove: (input) => invoke(IPC.pluginsRemove, input),
  },
};

contextBridge.exposeInMainWorld('cloudbox', api);
