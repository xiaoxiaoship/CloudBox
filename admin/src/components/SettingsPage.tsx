import { useEffect, useRef, useState, type FormEvent } from 'react';
import { autoT as t } from '../i18n.ts';
import { CollapsibleSection } from './CollapsibleSection.tsx';
import type { AdminSessionInfo, AdminSettings, FeaturePermissions, ScanConfig, SecurityBanEntry } from '../../../src/shared/ipcTypes.ts';
import { call, errorMessage, isWebAdmin } from '../api/ipc.ts';
import { useAdminApi } from '../api/AdminApiContext.tsx';
import { ConfirmDialog, Modal, type ToastState } from './Dialog.tsx';
import { SecurityPolicyPanel } from './SecurityPolicyPanel.tsx';
import { LowLevelSecurityPanel } from './LowLevelSecurityPanel.tsx';
import { DEFAULT_LOW_LEVEL_SECURITY } from '../../../src/shared/lowLevelSecurity.ts';
import { SimpleSecurityPanel } from './SimpleSecurityPanel.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { ArchiveIcon, CompressIcon, DatabaseIcon, EyeIcon, FolderIcon, HardDriveIcon, KeyIcon, MailIcon, RefreshIcon, SettingsIcon, ShareIcon, ShieldIcon, Spinner, UsersIcon } from './Icons.tsx';

interface SettingsPageProps {
  dataDir: string;
  storageDir: string;
  pluginsDir: string;
  notify: (kind: ToastState['kind'], message: string) => void;
  onPasswordChanged: () => Promise<void>;
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-950';

export function SettingsPage({
  dataDir,
  storageDir,
  pluginsDir,
  notify,
  onPasswordChanged,
}: SettingsPageProps) {
  const api = useAdminApi();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [backupPending, setBackupPending] = useState(false);
  const [cacheCleanup, setCacheCleanup] = useState({ autoEnabled: false, intervalHours: 24 });
  const [cachePending, setCachePending] = useState(false);
  const [directoryChange, setDirectoryChange] = useState<{
    kind: 'data' | 'storage' | 'plugins';
    targetPath: string;
  } | null>(null);
  const [migrate, setMigrate] = useState(true);
  const [deleteOld, setDeleteOld] = useState(false);
  const [directoryPending, setDirectoryPending] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [registrationLoaded, setRegistrationLoaded] = useState(false);
  const [registrationPending, setRegistrationPending] = useState(false);
  const [permissions, setPermissions] = useState<FeaturePermissions>({
    allowUserPreviewImage: true,
    allowUserPreviewVideo: true,
    allowUserPreviewPdf: true,
    allowUserPreviewOffice: true,
    allowUserExtract: true,
    allowUserScan: true,
    allowUserCompress: true,
    allowUserDirectShare: true,
    allowUserArchivePreview: true,
    allowGuestMode: false,
  });
  const [permissionsPending, setPermissionsPending] = useState(false);
  const [defaultQuotaBytes, setDefaultQuotaBytes] = useState(5 * 1024 ** 3);
  const [defaultQuotaPending, setDefaultQuotaPending] = useState(false);
  const [guestAddressMode, setGuestAddressMode] = useState<'auto' | 'public'>('auto');
  const [shareAddressMode, setShareAddressMode] = useState<'auto' | 'public'>('auto');
  const [addressModePending, setAddressModePending] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageData, setUsageData] = useState<Record<string, { users?: number; running: number; queued: number; paused: number }> | null>(null);
  const [security, setSecurity] = useState({
    mode: 'simple' as 'simple' | 'advanced',
    enabled: true,
    maxLoginFailures: 5,
    lockBaseMinutes: 1,
    lockMaxMinutes: 60,
    ipLoginLimit: 30,
    ipWindowMinutes: 15,
    ipLockMinutes: 15,
    simpleRegisterLimit: 2,
    renameEnabled: true,
    renameLimit: 1,
    renameWindowHours: 24,
    renameLockHours: 24,
    capEnabled: true,
    capLoginFailures: 3,
    capRegistrationLimit: 2,
    capShareLimit: 10,
    policy: '',
    adminIdleEnabled: true,
    adminIdleMinutes: 30,
    lowLevel: { ...DEFAULT_LOW_LEVEL_SECURITY },
  });
  const [adminSessions, setAdminSessions] = useState<AdminSessionInfo[] | null>(null);
  const [sessionsPending, setSessionsPending] = useState(false);
  const [securityPending, setSecurityPending] = useState(false);
  const [securityModeSnapshot, setSecurityModeSnapshot] = useState<'simple' | 'advanced'>('simple');
  const [modeChangeConfirm, setModeChangeConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [securityUsers, setSecurityUsers] = useState<Array<{ id: number; username: string; status: string; lockedUntil: number | null; renameLimitedUntil: number | null }>>([]);
  const [rateLimits, setRateLimits] = useState<Array<{ ip: string; until: number; endpoint: string }>>([]);
  const [securityBans, setSecurityBans] = useState<SecurityBanEntry[]>([]);
  const [logs, setLogs] = useState<{ runtime: string[]; audit: unknown[] } | null>(null);
  const [logsKind, setLogsKind] = useState<'runtime' | 'audit'>('runtime');
  const [logsPending, setLogsPending] = useState(false);
  const [deleteLogsConfirm, setDeleteLogsConfirm] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminRenamePending, setAdminRenamePending] = useState(false);
  const [startup, setStartup] = useState({ autoStart: false, startInTray: false });
  const [startupPending, setStartupPending] = useState(false);
  const [scan, setScan] = useState<ScanConfig>({
    enabled: false,
    mode: 'local',
    apiKey: '',
    localPath: '',
  });
  const [scanPending, setScanPending] = useState(false);
  const [ai, setAi] = useState({
    enabled: false,
    mode: 'admin' as 'admin' | 'user',
    baseUrl: '',
    model: 'gpt-4o-mini',
    hasApiKey: false,
    apiKeyMasked: '',
    dailyLimit: 50,
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiPending, setAiPending] = useState(false);
  const [hosting, setHosting] = useState<AdminSettings['hosting']>({ enabled: false, baseUrl: '', mode: 'auto' });
  const [hostingPending, setHostingPending] = useState(false);
  const [mail, setMail] = useState({
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    from: '',
    to: '',
    hasPass: false,
    passMasked: '',
    events: { userRegistered: true, securityAlert: true, securityLimit: true, resourceAlert: true, systemError: true },
  });
  const [mailPass, setMailPass] = useState('');
  const [mailPending, setMailPending] = useState(false);

  useEffect(() => {
    let active = true;
    void call(api.app.getStartup())
      .then((value) => {
        if (active) setStartup(value);
      })
      .catch(() => {});
    const loadUsers = async (): Promise<void> => {
      try {
        const users = await call(api.users.list());
        if (!active) return;
        const admin = users.find((user) => user.role === 'admin');
        if (admin) setAdminUsername(admin.username);
        setSecurityUsers(users);
        setRateLimits(await call(api.system.rateLimits()));
      setSecurityBans(await call(api.system.securityBans()));
        setSecurityBans(await call(api.system.securityBans()));
      } catch {
        // non-fatal
      }
    };
    void loadUsers();
    const usersTimer = window.setInterval(() => { void loadUsers(); }, 5000);
    return () => {
      active = false;
      window.clearInterval(usersTimer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void call(api.settings.get())
      .then((settings) => {
        if (!active) return;
        setAllowRegistration(settings.allowPublicRegistration);
        setPermissions(settings.permissions);
        setDefaultQuotaBytes(settings.defaultQuotaBytes);
        setGuestAddressMode(settings.guestAddressMode);
        setShareAddressMode(settings.shareAddressMode);
        setSecurity(settings.security);
        setSecurityModeSnapshot(settings.security.mode);
        setScan(settings.scan);
        setAi(settings.ai);
        setHosting(settings.hosting);
        setMail(settings.mail);
        setCacheCleanup(settings.cacheCleanup);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setRegistrationLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleRegistration = async (enabled: boolean): Promise<void> => {
    setRegistrationPending(true);
    try {
      const settings = await call(api.settings.setPublicRegistration({ enabled }));
      setAllowRegistration(settings.allowPublicRegistration);
      notify('success', enabled ? t('admin.settings.public-self-registration-enabled') : t('admin.settings.public-self-registration-disabled'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setRegistrationPending(false);
    }
  };

  const togglePermission = async (
    key: keyof FeaturePermissions,
    enabled: boolean,
  ): Promise<void> => {
    const previous = permissions;
    const next = { ...permissions, [key]: enabled };
    setPermissions(next);
    setPermissionsPending(true);
    try {
      const settings = await call(api.settings.setPermissions(next));
      setPermissions(settings.permissions);
      notify('success', t('admin.settings.feature-permissions-updated'));
    } catch (cause) {
      setPermissions(previous);
      notify('error', errorMessage(cause));
    } finally {
      setPermissionsPending(false);
    }
  };

  const exportLogs = async (): Promise<void> => {
    setLogsPending(true);
    try {
      const data = await call(api.logs.get({ limit: 500 }));
      const result = await call(api.logs.export(data));
      if (result.saved) notify('success', `鏃ュ織宸插鍑猴細${result.fileName ?? ''}`);
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setLogsPending(false);
    }
  };

  const clearLogs = async (): Promise<void> => {
    setLogsPending(true);
    try {
      await call(api.logs.clear());
      setLogs(null);
      setDeleteLogsConfirm(false);
      notify('success', t('admin.settings.runtime-and-audit-logs-deleted'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setLogsPending(false);
    }
  };

  const loadLogs = async (): Promise<void> => {
    setLogsPending(true);
    try {
      setLogs(await call(api.logs.get({ limit: 200 })));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setLogsPending(false);
    }
  };

  const saveCacheCleanup = async (): Promise<void> => {
    setCachePending(true);
    try {
      const next = await call(api.settings.setCacheCleanup(cacheCleanup));
      setCacheCleanup(next.cacheCleanup);
      notify('success', t('admin.settings.cache-cleanup-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setCachePending(false);
    }
  };

  const openUsage = async (): Promise<void> => {
    setUsageOpen(true);
    try { setUsageData(await call(api.system.taskUsage()) as Record<string, { users?: number; running: number; queued: number; paused: number }>); }
    catch (cause) { notify('error', errorMessage(cause)); }
  };

  const setAddressMode = async (target: 'guest' | 'share', mode: 'auto' | 'public'): Promise<void> => {
    setAddressModePending(true);
    try {
      const next = await call(api.settings.setAddressMode({ target, mode }));
      setGuestAddressMode(next.guestAddressMode);
      setShareAddressMode(next.shareAddressMode);
      notify('success', t('admin.settings.address-mode-saved'));
    } catch (cause) { notify('error', errorMessage(cause)); } finally { setAddressModePending(false); }
  };

  const saveDefaultQuota = async (): Promise<void> => {
    setDefaultQuotaPending(true);
    try {
      const next = await call(api.settings.setDefaultQuota({ bytes: Math.round(defaultQuotaBytes) }));
      setDefaultQuotaBytes(next.defaultQuotaBytes);
      notify('success', t('admin.settings.default-quota-saved'));
    } catch (cause) { notify('error', errorMessage(cause)); } finally { setDefaultQuotaPending(false); }
  };

  const saveLowLevel = async (lowLevel: AdminSettings['security']['lowLevel']): Promise<void> => {
    const next = { ...security, lowLevel };
    const result = await call(api.settings.setSecurity(next));
    setSecurity(result.security);
    notify('success', t('admin.settings.low-level-security-settings-saved'));
  };

  const saveStartup = async (): Promise<void> => {
    setStartupPending(true);
    try {
      setStartup(await call(api.app.setStartup(startup)));
      notify('success', t('admin.settings.startup-and-tray-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setStartupPending(false);
    }
  };

  const saveAdminUsername = async (): Promise<void> => {
    setAdminRenamePending(true);
    try {
      const result = await call(api.users.renameSelf({ username: adminUsername }));
      setAdminUsername(result.username);
      notify('success', t('admin.settings.administrator-username-updated'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setAdminRenamePending(false);
    }
  };

  const refreshSecurityUsers = async (): Promise<void> => {
    try {
      setSecurityUsers(await call(api.users.list()));
      setRateLimits(await call(api.system.rateLimits()));
      setSecurityBans(await call(api.system.securityBans()));
    } catch { /* non-fatal */ }
  };

  const unlockSecurityUser = async (userId: number): Promise<void> => {
    try {
      await call(api.users.unlock({ userId }));
      notify('success', t('admin.settings.account-unlocked'));
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const clearRateLimit = async (ip: string): Promise<void> => {
    try {
      await call(api.system.clearRateLimit({ ip }));
      notify('success', t('admin.settings.ip-rate-limit-cleared'));
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const clearRenameLimit = async (userId: number): Promise<void> => {
    try {
      await call(api.users.clearRenameLimit({ userId }));
      notify('success', t('admin.settings.rename-limit-cleared'));
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const clearAccountRestriction = async (userId: number): Promise<void> => {
    const user = securityUsers.find((entry) => entry.id === userId);
    if (!user) return;
    try {
      if (user.renameLimitedUntil !== null && user.renameLimitedUntil > Date.now()) {
        await call(api.users.clearRenameLimit({ userId }));
      }
      if (user.status === 'disabled') {
        await call(api.users.setStatus({ userId, status: 'active' }));
      } else if (user.lockedUntil !== null && user.lockedUntil > Date.now()) {
        await call(api.users.unlock({ userId }));
      }
      notify('success', t('admin.settings.account-restriction-cleared'));
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const enableSecurityUser = async (userId: number): Promise<void> => {
    try {
      await call(api.users.setStatus({ userId, status: 'active' }));
      notify('success', t('admin.settings.account-enabled'));
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const saveSecurity = async (force = false): Promise<void> => {
    if (!force && security.mode !== securityModeSnapshot) {
      setModeChangeConfirm(true);
      return;
    }
    setSecurityPending(true);
    try {
      const settings = await call(api.settings.setSecurity({ ...security, renameEnabled: security.enabled }));
      setSecurity(settings.security);
      notify('success', t('admin.settings.network-security-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setSecurityPending(false);
    }
  };

  const exportConfig = async (): Promise<void> => {
    try {
      const current = await call(api.settings.get());
      const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'cloudbox-settings.json';
      anchor.click();
      URL.revokeObjectURL(url);
      notify('success', t('admin.settings.configuration-exported-importing-across-versions'));
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const importConfig = async (file: File): Promise<void> => {
    try {
      const raw = JSON.parse(await file.text()) as Partial<ReturnType<typeof api.settings.get>>;
      const current = await call(api.settings.get());
      const next = { ...current, ...raw };
      await call(api.settings.setSecurity(next.security));
      await call(api.settings.setPermissions(next.permissions));
      await call(api.settings.setScan({ ...next.scan, apiKey: next.scan.apiKey.includes('***') ? '' : next.scan.apiKey }));
      await call(api.settings.setHosting(next.hosting));
      notify('success', t('admin.settings.configuration-imported-cross-version-settings-ma'));
      window.setTimeout(() => window.location.reload(), 500);
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const saveScan = async (): Promise<void> => {
    setScanPending(true);
    try {
      const settings = await call(api.settings.setScan(scan));
      setScan(settings.scan);
      notify('success', t('admin.settings.security-scan-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setScanPending(false);
    }
  };

  const saveAi = async (): Promise<void> => {
    setAiPending(true);
    try {
      const settings = await call(
        api.settings.setAi({
          enabled: ai.enabled,
          mode: ai.mode,
          baseUrl: ai.baseUrl,
          apiKey: apiKeyInput,
          model: ai.model,
          dailyLimit: ai.dailyLimit,
        }),
      );
      setAi(settings.ai);
      setApiKeyInput('');
      notify('success', t('admin.settings.ai-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setAiPending(false);
    }
  };

  const saveHosting = async (): Promise<void> => {
    setHostingPending(true);
    try {
      const settings = await call(api.settings.setHosting(hosting));
      setHosting(settings.hosting);
      notify('success', t('admin.settings.static-hosting-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setHostingPending(false);
    }
  };

  const saveMail = async (): Promise<void> => {
    setMailPending(true);
    try {
      const settings = await call(
        api.settings.setMail({
          enabled: mail.enabled,
          host: mail.host,
          port: mail.port,
          secure: mail.secure,
          user: mail.user,
          pass: mailPass,
          from: mail.from,
          to: mail.to,
          eventUserRegistered: mail.events.userRegistered,
          eventSecurityAlert: mail.events.securityAlert,
          eventSecurityLimit: mail.events.securityLimit,
          eventResourceAlert: mail.events.resourceAlert,
          eventSystemError: mail.events.systemError,
        }),
      );
      setMail(settings.mail);
      setMailPass('');
      notify('success', t('admin.settings.mail-notification-settings-saved'));
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setMailPending(false);
    }
  };

  const testMail = async (): Promise<void> => {
    try {
      const result = await call(api.settings.testMail());
      notify(result.ok ? 'success' : 'error', result.message);
    } catch (cause) {
      notify('error', errorMessage(cause));
    }
  };

  const changePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (currentPassword === '') {
      setPasswordError('请输入当前密码');
      return;
    }
    if (newPassword === '') {
      setPasswordError('请输入新密码');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('新密码至少需要 8 位');
      return;
    }
    if (confirmPassword === '') {
      setPasswordError('请再次输入新密码');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('admin.settings.the-new-passwords-do-not-match'));
      return;
    }

    setChanging(true);
    setPasswordError(null);
    try {
      await call(api.auth.changePassword({ currentPassword, newPassword }));
      notify('success', t('admin.settings.administrator-password-changed-please-sign-in-ag'));
      await onPasswordChanged();
    } catch (cause) {
      setPasswordError(errorMessage(cause));
    } finally {
      setChanging(false);
    }
  };

  const backupDatabase = async (): Promise<void> => {
    setBackupPending(true);
    try {
      const result = await call(api.app.backupDatabase());
      if (result.saved) {
        notify('success', `鏁版嵁搴撳凡澶囦唤锛?{result.fileName ?? t('admin.settings.backup-file')}`);
      }
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setBackupPending(false);
    }
  };

  const chooseDirectory = async (kind: 'data' | 'storage' | 'plugins'): Promise<void> => {
    if (isWebAdmin) {
      setDirectoryError(null);
      setMigrate(true);
      setDeleteOld(false);
      setDirectoryChange({ kind, targetPath: '' });
      return;
    }
    try {
      const result = await call(api.app.chooseDirectory({ kind }));
      if (!result.selected || !result.path) return;
      setDirectoryError(null);
      setMigrate(true);
      setDeleteOld(false);
      setDirectoryChange({ kind, targetPath: result.path });
    } catch (cause) {
      notify('error', errorMessage(cause));
    }
  };

  const confirmDirectoryChange = async (): Promise<void> => {
    if (!directoryChange) return;
    if (isWebAdmin && !/^[A-Za-z]:[\\/]|^\\\\/.test(directoryChange.targetPath.trim())) {
      setDirectoryError(t('admin.directory.invalid'));
      return;
    }
    setDirectoryPending(true);
    setDirectoryError(null);
    try {
      await call(
        api.app.changeDirectory({
          kind: directoryChange.kind,
          targetPath: directoryChange.targetPath,
          migrate,
          deleteOld,
        }),
      );
      notify('success', t('admin.settings.text'));
      setDirectoryChange(null);
    } catch (cause) {
      setDirectoryError(errorMessage(cause));
    } finally {
      setDirectoryPending(false);
    }
  };

  const refreshAdminSessions = async (): Promise<void> => {
    if (!api.auth.sessions) return;
    setSessionsPending(true);
    try { setAdminSessions(await call(api.auth.sessions())); }
    catch (cause) { notify('error', errorMessage(cause)); }
    finally { setSessionsPending(false); }
  };

  const revokeAllAdminSessions = async (): Promise<void> => {
    if (!api.auth.revokeAllSessions) return;
    setSessionsPending(true);
    try {
      await call(api.auth.revokeAllSessions());
      setAdminSessions([]);
      notify('success', t('admin.sessions.revoked'));
      await onPasswordChanged();
    } catch (cause) { notify('error', errorMessage(cause)); }
    finally { setSessionsPending(false); }
  };

  useEffect(() => {
    if (api.auth.sessions) void refreshAdminSessions();
  }, [api.auth.sessions]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setResetConfirm(true)} className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-950/40">{t('admin.settings.restore-defaults')}</button>
          <button type="button" onClick={() => void exportConfig()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">{t('admin.settings.export-configuration')}</button>
          <button type="button" onClick={() => importInputRef.current?.click()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">{t('admin.settings.import-configuration')}</button>
          <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importConfig(file); event.target.value = ''; }} />
        </div>
        <LanguageSwitcher />
      </div>

      <section className="rounded-2xl border border-indigo-900/60 bg-indigo-950/20 p-4">
        <h2 className="text-sm font-semibold text-indigo-200">{t('admin.settings.quickStart')}</h2>
        <ol className="mt-2 grid gap-2 text-xs leading-5 text-slate-300 sm:grid-cols-2">
          <li>1. {t('admin.settings.quickStartNetwork')}</li>
          <li>2. {t('admin.settings.quickStartUsers')}</li>
          <li>3. {t('admin.settings.quickStartPermissions')}</li>
          <li>4. {t('admin.settings.quickStartBackup')}</li>
        </ol>
      </section>

            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('admin.settings.administrator-account')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('admin.settings.administrator-password-account-details-and-sign-')}</p>
      </div>

<CollapsibleSection>
        <div className="flex items-center gap-2">
          <KeyIcon className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.administrator-password')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('admin.settings.all-administrator-sessions-will-be-revoked-after')}
        </p>

        <form onSubmit={(event) => void changePassword(event)} className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="current-password">
              {t('admin.settings.current-password')}
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="new-admin-password">
              {t('admin.settings.new-password')}
            </label>
            <input
              id="new-admin-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={INPUT_CLASS}
              placeholder={t('admin.settings.at-least-8-characters-with-letters-and-numbers')}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="confirm-admin-password">
              {t('admin.settings.confirmNewPassword')}
            </label>
            <input
              id="confirm-admin-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>

          {passwordError ? (
            <p className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300 md:col-span-3">
              {passwordError}
            </p>
          ) : null}

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={changing}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {changing ? <Spinner className="h-4 w-4" /> : null}
              {t('admin.settings.changePassword')}
            </button>
          </div>
        </form>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex items-center gap-2">
          <KeyIcon className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.administrator-account')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('admin.settings.the-administrator-can-change-the-username-here-p')}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-slate-500">{t('admin.settings.admin-username')}
            <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} className={`${'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-500'} min-w-64`} />
          </label>
          <button type="button" onClick={() => void saveAdminUsername()} disabled={adminRenamePending || !adminUsername.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {adminRenamePending ? <Spinner className="h-4 w-4" /> : null}
            {t('admin.settings.saveUsername')}
          </button>
        </div>
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-200">{t('admin.settings.administrator-gui-idle-lock')}</p>
              <p className="mt-1 text-xs text-slate-500">{t('admin.settings.sign-out-automatically-after-inactivity-saved-wi')}</p>
            </div>
            <button type="button" role="switch" aria-checked={security.adminIdleEnabled} onClick={() => setSecurity((current) => ({ ...current, adminIdleEnabled: !current.adminIdleEnabled }))} className={`relative h-7 w-12 shrink-0 rounded-full transition ${security.adminIdleEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${security.adminIdleEnabled ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          <label className="mt-3 block text-[11px] text-slate-500">{t('admin.settings.idle-timeout-minutes')}
            <input type="number" min={1} max={1440} value={security.adminIdleMinutes} disabled={!security.adminIdleEnabled} onChange={(event) => setSecurity((current) => ({ ...current, adminIdleMinutes: Math.max(1, Math.min(1440, Number(event.target.value) || 30)) }))} className={`${INPUT_CLASS} max-w-48 disabled:opacity-50`} />
          </label>
        </div>
        {api.auth.sessions ? (
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-200">{t('admin.sessions.title')}</p>
                <p className="mt-1 text-xs text-slate-500">{t('admin.sessions.description')}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void refreshAdminSessions()} disabled={sessionsPending} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-60">
                  {sessionsPending ? <Spinner className="h-3.5 w-3.5" /> : null}
                  t('admin.sessions.refresh')
                </button>
                <button type="button" onClick={() => void revokeAllAdminSessions()} disabled={sessionsPending} className="rounded-lg border border-rose-800/60 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/30 disabled:opacity-60">
                  t('admin.sessions.revokeAll')
                </button>
              </div>
            </div>
            {adminSessions === null ? null : adminSessions.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">{t('admin.sessions.empty')}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-400">
                  <thead><tr className="border-b border-slate-800 text-slate-500"><th className="px-2 py-2">{t('admin.sessions.ip')}</th><th className="px-2 py-2">{t('admin.sessions.device')}</th><th className="px-2 py-2">{t('admin.sessions.lastSeen')}</th><th className="px-2 py-2">{t('admin.sessions.expires')}</th></tr></thead>
                  <tbody>
                    {adminSessions.map((session, index) => (
                      <tr key={index} className="border-b border-slate-900/60">
                        <td className="px-2 py-2">{session.ip ?? '-'}{session.current ? ` (${t('admin.sessions.current')})` : ''}</td>
                        <td className="max-w-64 truncate px-2 py-2" title={session.userAgent ?? ''}>{session.userAgent ?? '-'}</td>
                        <td className="px-2 py-2">{new Date(session.lastSeenAt).toLocaleString('zh-CN')}</td>
                        <td className="px-2 py-2">{new Date(session.expiresAt).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </CollapsibleSection>

            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('admin.settings.security-and-operations')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('admin.settings.network-security-and-access-protection')}</p>
      </div>

<CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <KeyIcon className="h-4 w-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.text-24')}</h2>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">Beta</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${security.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{security.enabled ? t('admin.settings.enabled') : t('admin.settings.disabled')}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {security.mode === 'simple'
                ? t('admin.settings.uses-legacy-account-lock-ip-rate-limit-and-renam')
                : t('admin.settings.uses-drag-and-drop-policy-global-bans-ips-and-ac')}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={security.enabled} onClick={() => setSecurity((current) => ({ ...current, enabled: !current.enabled }))} className={`relative h-7 w-12 shrink-0 rounded-full transition ${security.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${security.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="mt-4 flex gap-2 border-b border-slate-800 pb-2">
          <button type="button" onClick={() => setSecurity((current) => ({ ...current, mode: 'simple' }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${security.mode === 'simple' ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>{t('admin.settings.simple-mode')}</button>
          <button type="button" onClick={() => setSecurity((current) => ({ ...current, mode: 'advanced' }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${security.mode === 'advanced' ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>{t('admin.settings.advanced-mode')}</button>
        </div>

        <div className="mt-4">
          {security.mode === 'simple' ? (
            <SimpleSecurityPanel
              value={security}
              onChange={(patch) => setSecurity((current) => ({ ...current, ...patch }))}
              accounts={securityUsers}
              rateLimits={rateLimits}
              onUnlock={(userId) => void unlockSecurityUser(userId)}
              onClearRename={(userId) => void clearRenameLimit(userId)}
              onEnable={(userId) => void enableSecurityUser(userId)}
              onClearIp={(ip) => void clearRateLimit(ip)}
            />
          ) : null}
          {security.mode === 'advanced' ? (
          <SecurityPolicyPanel
            rawPolicy={security.policy}
            onChange={(policy) => setSecurity((current) => ({ ...current, policy }))}
            notify={notify}
            accounts={securityUsers}
            rateLimits={rateLimits}
            bans={securityBans}
            onClearBan={async (id) => {
              try {
                const ban = securityBans.find((entry) => entry.id === id);
                await call(api.system.clearSecurityBan({ id }));
                if (ban?.scope === 'account') {
                  const userId = Number(ban.target);
                  const account = securityUsers.find((entry) => entry.id === userId);
                  if (ban.feature === 'renameLimit' || ban.feature === 'global') {
                    if (account?.renameLimitedUntil !== null && account?.renameLimitedUntil !== undefined) {
                      await call(api.users.clearRenameLimit({ userId }));
                    }
                    if (ban.feature === 'global') {
                      await clearAccountRestriction(userId);
                    }
                  } else if (ban.feature === 'loginFailure') {
                    await call(api.users.unlock({ userId }));
                  }
                } else if (ban?.scope === 'ip' && ban.feature === 'global') {
                  await call(api.system.clearRateLimit({ ip: ban.target }));
                }
                setSecurityBans(await call(api.system.securityBans()));
                await refreshSecurityUsers();
                notify('success', t('admin.settings.text-3'));
              } catch (cause) { notify('error', errorMessage(cause)); }
            }}
            onClearAccount={(userId) => void clearAccountRestriction(userId)}
            onClearIp={(ip) => void clearRateLimit(ip)}
            onRefresh={refreshSecurityUsers}
            onClearAll={async () => {
              try {
                const result = await call(api.system.clearAllSecurityBans());
                await refreshSecurityUsers();
                notify('success', t('admin.settings.bansCleared', { count: result.removed }));
              } catch (cause) { notify('error', errorMessage(cause)); }
            }}
            capSettings={{ enabled: security.capEnabled, loginFailures: security.capLoginFailures, registrationLimit: security.capRegistrationLimit, shareLimit: security.capShareLimit }}
            onCapSettingsChange={(value) => setSecurity((current) => ({ ...current, capEnabled: value.enabled, capLoginFailures: value.loginFailures, capRegistrationLimit: value.registrationLimit, capShareLimit: value.shareLimit }))}
          />
          ) : null}
        </div>

        <button type="button" onClick={() => void saveSecurity()} disabled={securityPending} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {securityPending ? <Spinner className="h-4 w-4" /> : null}
          {t('admin.settings.saveSecuritySettings')}
        </button>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex items-center gap-2">
          <ShieldIcon className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.low-level-security-controls')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('admin.settings.waf')}</p>
        <div className="mt-4">
          <LowLevelSecurityPanel
            embedded
            value={security.lowLevel}
            policyRaw={security.policy}
            onChange={(lowLevel) => setSecurity((current) => ({ ...current, lowLevel }))}
            onSave={saveLowLevel}
          />
        </div>
      </CollapsibleSection>

      
<section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <RefreshIcon className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.runtimeAndAuditLogs')}</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">{t('admin.settings.view-recent-process-logs-or-audit-records-from-t')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportLogs()} disabled={logsPending} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">{t('admin.settings.export-logs')}</button>
            <button type="button" onClick={() => setDeleteLogsConfirm(true)} disabled={logsPending} className="rounded-lg border border-rose-800/60 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-50">{t('admin.settings.delete-logs')}</button>
            <button type="button" onClick={() => void loadLogs()} disabled={logsPending} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
              {logsPending ? t('common.loading') : t('admin.logs.refresh')}
            </button>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {(['runtime', 'audit'] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => setLogsKind(kind)} className={`rounded-lg px-3 py-1 text-xs ${logsKind === kind ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'}`}>
              {kind === 'runtime' ? t('admin.settings.runtime-logs') : t('admin.settings.audit-logs')}
            </button>
          ))}
        </div>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-400">
          {logs
            ? logsKind === 'runtime'
              ? logs.runtime.join('\n') || t('admin.settings.no-runtime-logs')
              : JSON.stringify(logs.audit, null, 2)
            : t('admin.logs.clickRefresh')}
        </pre>
      </section>


            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('admin.settings.feature-controls')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('admin.settings.self-registration-user-permissions-scans-ai-stat')}</p>
      </div>

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.public-self-registration')}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                allowRegistration
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {allowRegistration ? t('admin.settings.enabled') : t('admin.settings.disabled')}
            </span>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={allowRegistration}
            aria-label={t('admin.settings.allow-public-self-registration')}
            disabled={!registrationLoaded || registrationPending}
            onClick={() => void toggleRegistration(!allowRegistration)}
            className={`relative h-7 w-12 rounded-full transition ${
              allowRegistration ? 'bg-emerald-500' : 'bg-slate-700'
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                allowRegistration ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('admin.settings.disabled-by-default-when-enabled-the-login-page-')}
        </p>
        <p className="mt-2 text-[11px] text-slate-500">
          新注册用户角色为普通用户，状态正常，默认分配 5 GB 配额；高级模式的注册频率由注册量策略卡控制。</p>
        {registrationPending ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Spinner className="h-3 w-3" />
            {t('admin.settings.updating-settings')}
          </p>
        ) : null}
      </CollapsibleSection>

<CollapsibleSection>
        <div className="flex items-center gap-2">
          <EyeIcon className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.text-25')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('admin.settings.when-disabled-the-web-entry-is-hidden-and-backen')}
        </p>

        <div className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800">
          {(
            [
              ['allowUserPreviewImage', t('admin.settings.image-preview'), t('admin.settings.allow-users-to-preview-png-jpg-webp-images-in-th')],
              ['allowUserPreviewVideo', t('admin.settings.video-playback'), t('admin.settings.allow-mp4-webm-ogg-video-playback')],
              ['allowUserPreviewPdf', t('admin.settings.pdf-preview'), t('admin.settings.allow-pdf-rendering-in-the-browser')],
              ['allowUserPreviewOffice', t('admin.settings.word-excel-ppt-preview'), t('admin.settings.allow-online-preview-of-docx-xlsx-pptx-files')],
              ['allowUserArchivePreview', t('admin.settings.text-4'), t('admin.settings.zip-7z')],
            ] as const
          ).map(([key, title, description]) => {
            const checked = permissions[key];
            return (
              <div key={key} className="flex items-start justify-between gap-4 px-3 py-3">
                <div>
                  <p className="text-xs font-medium text-slate-200">{title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  aria-label={title}
                  disabled={permissionsPending}
                  onClick={() => void togglePermission(key, !checked)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    checked ? 'bg-emerald-500' : 'bg-slate-700'
                  } disabled:opacity-50`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      checked ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {([
        ['allowUserExtract', t('admin.settings.online-extraction'), t('admin.settings.text-5')],
        ['allowUserCompress', t('admin.settings.text-6'), t('admin.settings.zip')],
        ['allowUserDirectShare', t('admin.settings.text-7'), t('admin.settings.text-8')],
        ['allowGuestMode', t('admin.settings.text-9'), t('admin.settings.text-10')],
      ] as const).map(([key, title, description]) => {
        const checked = permissions[key];
        const Icon = key === 'allowUserExtract' ? ArchiveIcon : key === 'allowUserCompress' ? CompressIcon : key === 'allowUserDirectShare' ? ShareIcon : UsersIcon;
        return (
          <CollapsibleSection key={key}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${checked ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{checked ? t('admin.settings.enabled') : t('admin.settings.disabled')}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{description}；关闭后 Web 隐藏入口，后端接口同时拒绝。</p>
              </div>
              <button type="button" role="switch" aria-checked={checked} aria-label={title} disabled={permissionsPending} onClick={() => void togglePermission(key, !checked)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-700'} disabled:opacity-50`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            {(key === 'allowGuestMode' || key === 'allowUserDirectShare') ? (
            <div className="mt-3 rounded-lg border border-slate-800 p-2.5 text-[11px] text-slate-400">
            <p className="mb-2 text-slate-300">{t('admin.settings.text-26')}</p>
            <label className="flex items-start gap-2 py-1">
            <input type="radio" name={`address-mode-${key}`} checked={(key === 'allowGuestMode' ? guestAddressMode : shareAddressMode) === 'auto'} disabled={addressModePending} onChange={() => void setAddressMode(key === 'allowGuestMode' ? 'guest' : 'share', 'auto')} />
            <span><strong className="text-slate-300">{t('admin.settings.text-27')}</strong>{t('admin.settings.ip-2')}</span>
            </label>
            <label className="flex items-start gap-2 py-1">
            <input type="radio" name={`address-mode-${key}`} checked={(key === 'allowGuestMode' ? guestAddressMode : shareAddressMode) === 'public'} disabled={addressModePending} onChange={() => void setAddressMode(key === 'allowGuestMode' ? 'guest' : 'share', 'public')} />
            <span><strong className="text-slate-300">{t('admin.settings.text-28')}</strong>{t('admin.settings.ip-3')}</span>
            </label>
          <p className="mt-1 text-slate-500">当前公网基础地址：{hosting.baseUrl || '未配置，自动模式会回退到当前访问地址'}</p>
            </div>
            ) : null}
          </CollapsibleSection>
        );
      })}

      <CollapsibleSection>
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.text-29')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('admin.settings.text-30')}</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-slate-500">{t('admin.settings.gb')}
            <input type="number" min={0} step="0.5" value={defaultQuotaBytes / 1024 ** 3} onChange={(event) => setDefaultQuotaBytes(Math.max(0, Number(event.target.value) || 0) * 1024 ** 3)} className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <button type="button" onClick={() => void saveDefaultQuota()} disabled={defaultQuotaPending} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">{defaultQuotaPending ? t('admin.settings.saving') : t('admin.settings.text-12')}</button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldIcon className="h-4 w-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-slate-100">安全查杀</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  scan.enabled
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {scan.enabled ? t('admin.settings.enabled-2') : t('admin.settings.disabled')}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              API 模式使用 VirusTotal（文件上限 32MB）；本地模式调用配置目录中的 ClamAV 引擎。结果为 infected 的文件会被强制禁止下载、分享和解压。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={scan.enabled}
            aria-label={t('admin.settings.security-scanning-master-switch')}
            onClick={() => setScan((current) => ({ ...current, enabled: !current.enabled }))}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              scan.enabled ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                scan.enabled ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="scan-mode">
              {t('admin.settings.text-20')}妯″紡
            </label>
            <select
              id="scan-mode"
              value={scan.mode}
              onChange={(event) =>
                setScan((current) => ({
                  ...current,
                  mode: event.target.value as 'api' | 'local',
                }))
              }
              className={INPUT_CLASS}
            >
              <option value="local">{t('admin.settings.local-clamav')}</option>
              <option value="api">VirusTotal API</option>
            </select>
          </div>

          {scan.mode === 'api' ? (
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="scan-api-key">
                VirusTotal API Key
              </label>
              <input
                id="scan-api-key"
                type="password"
                value={scan.apiKey}
                onChange={(event) =>
                  setScan((current) => ({ ...current, apiKey: event.target.value }))
                }
                className={INPUT_CLASS}
                placeholder={t('admin.settings.stored-only-in-the-local-database')}
              />
            </div>
          ) : (
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="scan-local-path">
                {t('admin.settings.clamav-directory')}
              </label>
              <input
                id="scan-local-path"
                value={scan.localPath}
                onChange={(event) =>
                  setScan((current) => ({ ...current, localPath: event.target.value }))
                }
                className={INPUT_CLASS}
                placeholder={t('admin.settings.c-program-files-clamav')}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void saveScan()}
          disabled={scanPending}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {scanPending ? <Spinner className="h-4 w-4" /> : null}
          保存查杀设置
        </button>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.ai-service')}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${ai.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {ai.enabled ? t('admin.settings.ai-enabled') : t('admin.settings.ai-disabled')}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t('admin.settings.api-key-aes-256-gcm')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ai.enabled}
            aria-label={t('admin.settings.ai-master-switch')}
            onClick={() => setAi((current) => ({ ...current, enabled: !current.enabled }))}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${ai.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${ai.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="ai-mode">{t('admin.settings.ai-mode')}</label>
            <select id="ai-mode" value={ai.mode} onChange={(event) => setAi((current) => ({ ...current, mode: event.target.value as 'admin' | 'user' }))} className={INPUT_CLASS}>
              <option value="admin">{t('admin.settings.administrator-shared-configuration')}</option>
              <option value="user">{t('admin.settings.user-provided-configuration')}</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="ai-daily-limit">{t('admin.settings.daily-limit-for-regular-users')}</label>
            <input id="ai-daily-limit" type="number" min={1} max={10000} value={ai.dailyLimit} onChange={(event) => setAi((current) => ({ ...current, dailyLimit: Number(event.target.value) }))} className={INPUT_CLASS} />
          </div>
          {ai.mode === 'admin' ? (
            <>
              <div>
                <label className="text-[11px] text-slate-500" htmlFor="ai-base-url">Base URL</label>
                <input id="ai-base-url" value={ai.baseUrl} onChange={(event) => setAi((current) => ({ ...current, baseUrl: event.target.value }))} className={INPUT_CLASS} placeholder="https://api.openai.com/v1" />
              </div>
              <div>
                <label className="text-[11px] text-slate-500" htmlFor="ai-model">Model</label>
                <input id="ai-model" value={ai.model} onChange={(event) => setAi((current) => ({ ...current, model: event.target.value }))} className={INPUT_CLASS} />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] text-slate-500" htmlFor="ai-admin-key">管理员 API Key（脱敏展示：{ai.apiKeyMasked || '未配置'}）</label>
                <input id="ai-admin-key" type="password" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} className={INPUT_CLASS} placeholder={ai.hasApiKey ? t('admin.settings.leave-blank-to-keep-the-current-key') : 'sk-...'} />
              </div>
            </>
          ) : (
            <p className="md:col-span-2 rounded-lg border border-sky-900/50 bg-sky-950/20 px-3 py-2 text-xs text-sky-300">
              {t('admin.settings.user-mode-administrator-base-url-api-key-are-hid')}
            </p>
          )}
        </div>

        <button type="button" onClick={() => void saveAi()} disabled={aiPending} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60">
          {aiPending ? <Spinner className="h-4 w-4" /> : null}
          保存 AI 设置
        </button>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FolderIcon className="h-4 w-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.static-hosting')}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${hosting.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {hosting.enabled ? t('admin.settings.enabled') : t('admin.settings.disabled')}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t('admin.settings.sites-are-served-under')} <code>/host/</code> 下，不额外监听端口。自动模式按访问请求的协议与 Host 生成链接，无需手填内网地址。</p>
          </div>
          <button type="button" role="switch" aria-checked={hosting.enabled} aria-label={t('admin.settings.static-hosting-master-switch')} onClick={() => setHosting((current) => ({ ...current, enabled: !current.enabled }))} className={`relative h-7 w-12 shrink-0 rounded-full transition ${hosting.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${hosting.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="mt-4">
          <p className="text-[11px] text-slate-500">{t('admin.settings.text-26')}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-300">
            <label className="flex items-center gap-2">
              <input type="radio" name="hosting-mode" value="auto" checked={hosting.mode === 'auto'} onChange={() => setHosting((current) => ({ ...current, mode: 'auto' }))} className="accent-indigo-500" />
              自动（内网）
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="hosting-mode" value="public" checked={hosting.mode === 'public'} onChange={() => setHosting((current) => ({ ...current, mode: 'public' }))} className="accent-indigo-500" />
              {t('admin.settings.text-32')}
            </label>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            自动模式使用当前访问的协议与 Host（含端口）生成绝对地址；公网模式优先使用下方固定地址，未填写时同样回退到当前请求地址。</p>
        </div>
        {hosting.mode === 'public' ? (
          <div className="mt-3">
            <label className="block text-[11px] text-slate-500" htmlFor="hosting-base-url">{t('admin.settings.text-33')}</label>
            <input id="hosting-base-url" value={hosting.baseUrl} onChange={(event) => setHosting((current) => ({ ...current, baseUrl: event.target.value }))} className={INPUT_CLASS} placeholder={t('admin.settings.e-g-https-pan-yourdomain-com')} />
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-slate-500">CSP、HSTS、nosniff 等安全响应头由服务端根据访问协议自动生成，无需手动填写。</p>
        <button type="button" onClick={() => void saveHosting()} disabled={hostingPending} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {hostingPending ? <Spinner className="h-4 w-4" /> : null}
          保存托管设置
        </button>
      </CollapsibleSection>

      

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><MailIcon className="h-4 w-4 text-emerald-400" /><h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.email-notifications')}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] ${mail.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{mail.enabled ? t('admin.settings.enabled') : t('admin.settings.disabled')}</span></div>
            <p className="mt-1 text-xs text-slate-500">{t('admin.settings.smtp-alerts-are-sent-asynchronously-passwords-ar')}</p>
          </div>
          <button type="button" role="switch" aria-checked={mail.enabled} aria-label={t('admin.settings.email-master-switch')} onClick={() => setMail((current) => ({ ...current, enabled: !current.enabled }))} className={`relative h-7 w-12 rounded-full transition ${mail.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${mail.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-host">SMTP Host</label><input id="mail-host" value={mail.host} onChange={(e) => setMail((c) => ({ ...c, host: e.target.value }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-port">Port</label><input id="mail-port" type="number" value={mail.port} onChange={(e) => setMail((c) => ({ ...c, port: Number(e.target.value) }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-user">{t('admin.settings.smtpUser')}</label><input id="mail-user" value={mail.user} onChange={(e) => setMail((c) => ({ ...c, user: e.target.value }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-pass">授权码/密码（{mail.passMasked || '未配置'}）</label><input id="mail-pass" type="password" value={mailPass} onChange={(e) => setMailPass(e.target.value)} className={INPUT_CLASS} placeholder={mail.hasPass ? '留空保持现有密码' : '请输入 QQ 邮箱授权码'} />{!mail.hasPass && mail.user ? <p className="mt-1 text-[10px] text-amber-300">未配置或无法解密，请重新填写授权码</p> : null}</div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-from">{t('admin.settings.sender')}</label><input id="mail-from" value={mail.from} onChange={(e) => setMail((c) => ({ ...c, from: e.target.value }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-to">{t('admin.settings.alertRecipient')}</label><input id="mail-to" value={mail.to} onChange={(e) => setMail((c) => ({ ...c, to: e.target.value }))} className={INPUT_CLASS} /></div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={mail.secure} onChange={(e) => setMail((c) => ({ ...c, secure: e.target.checked }))} className="accent-indigo-500" />TLS（secure）</label>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.userRegistered} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, userRegistered: e.target.checked } }))} className="accent-indigo-500" />{t('admin.settings.new-registration')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.securityAlert} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, securityAlert: e.target.checked } }))} className="accent-indigo-500" />{t('admin.settings.security-alert')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.securityLimit} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, securityLimit: e.target.checked } }))} className="accent-indigo-500" />{t('admin.settings.security-restriction-triggered')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.resourceAlert} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, resourceAlert: e.target.checked } }))} className="accent-indigo-500" />{t('admin.settings.local-resource-alert')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.systemError} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, systemError: e.target.checked } }))} className="accent-indigo-500" />{t('admin.settings.system-error')}</label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => void saveMail()} disabled={mailPending} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{mailPending ? t('admin.settings.saving') : t('admin.settings.save-email-settings')}</button>
          <button type="button" onClick={() => void testMail()} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">{t('admin.settings.send-test-email')}</button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex items-center gap-2">
          <EyeIcon className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.text-17')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">查看解压、压缩、查杀的当前用户、运行、排队与暂停数量。</p>
        <button type="button" onClick={() => void openUsage()} className="mt-3 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">查看功能使用状态</button>
      </CollapsibleSection>

            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('admin.settings.system-and-storage')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('admin.settings.text-14')}</p>
      </div>


      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <RefreshIcon className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.cache-cleanup')}</h2>
          </div>
          
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('admin.settings.1-part')}</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300">
            <span>{t('admin.settings.automatic-cleanup')}</span>
            <input type="checkbox" checked={cacheCleanup.autoEnabled} onChange={(e) => setCacheCleanup((c) => ({ ...c, autoEnabled: e.target.checked }))} className="h-4 w-4 accent-indigo-500" />
          </label>
          <label className="text-[11px] text-slate-500">{t('admin.settings.cleanup-interval-hours')}
            <input type="number" min={1} max={720} value={cacheCleanup.intervalHours} onChange={(e) => setCacheCleanup((c) => ({ ...c, intervalHours: Number(e.target.value) || 1 }))} className="mt-1 block w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          </label>
          <button
                      type="button"
                      onClick={async () => {
                        setCachePending(true);
                        try {
                          const result = await call(api.settings.clearResourceCache());
                          notify('success', '已清理缓存，清理过期审计 ' + result.removedLogs + ' 条');
                        } catch (cause) { notify('error', errorMessage(cause)); } finally { setCachePending(false); }
                      }}
                      disabled={cachePending}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {cachePending ? <Spinner className="h-3.5 w-3.5" /> : null}
                      {t('admin.settings.clean-now')}
                    </button>
          <button type="button" onClick={() => void saveCacheCleanup()} disabled={cachePending} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{t('admin.settings.save-cache-cleanup-settings')}</button>
        </div>
      </CollapsibleSection>


<CollapsibleSection>
        <div className="flex items-center gap-2">
          <HardDriveIcon className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.startup-tray')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">控制登录 Windows 后是否自动启动 CloudBox，以及启动后是否隐藏在系统托盘。</p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300">
            <span>开机自动启动 CloudBox<br /><span className="text-[11px] text-slate-500">{t('admin.settings.applies-to-installed-builds-development-builds-d')}</span></span>
            <input type="checkbox" checked={startup.autoStart} onChange={(event) => setStartup((current) => ({ ...current, autoStart: event.target.checked }))} className="h-4 w-4 accent-indigo-500" />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300">
            <span>{t('admin.settings.minimize-to-system-tray-after-auto-start')}<br /><span className="text-[11px] text-slate-500">{t('admin.settings.requires-the-previous-option-manual-launches-sti')}</span></span>
            <input type="checkbox" checked={startup.startInTray} disabled={!startup.autoStart} onChange={(event) => setStartup((current) => ({ ...current, startInTray: event.target.checked }))} className="h-4 w-4 accent-indigo-500 disabled:opacity-40" />
          </label>
          <button type="button" onClick={() => void saveStartup()} disabled={startupPending} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {startupPending ? <Spinner className="h-4 w-4" /> : null}
            保存启动设置
          </button>
        </div>
      </CollapsibleSection>


      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-2">
          <DatabaseIcon className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.database-backup')}</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          使用 SQLite 在线备份 API 导出当前数据库（包含用户、配额、设置与审计日志）。</p>

        <button
          type="button"
          onClick={() => void backupDatabase()}
          disabled={backupPending}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
        >
          {backupPending ? <Spinner className="h-4 w-4" /> : <DatabaseIcon className="h-4 w-4" />}
          选择位置并备份
        </button>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDriveIcon className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.system-data-directory')}</h2>
          </div>
          <button
            type="button"
            onClick={() => void chooseDirectory('data')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            {t('admin.settings.change-directory')}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('admin.settings.stores-cloudbox-db-ssl-certificates-ca-and-frp-c')}
        </p>
        <p className="mt-2 select-all break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
          {dataDir}
        </p>
        {!isWebAdmin ? (
          <button
            type="button"
            onClick={() =>
              isWebAdmin ? undefined : void call(api.app.openDataDir()).catch((error: unknown) =>
                notify('error', errorMessage(error)),
              )
            }
            className="mt-3 text-xs text-indigo-300 transition hover:text-indigo-200"
          >
            {t('admin.settings.open-in-file-manager')}
          </button>
          ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDriveIcon className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.drive-files-directory')}</h2>
          </div>
          <button
            type="button"
            onClick={() => void chooseDirectory('storage')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            {t('admin.settings.change-directory')}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('admin.settings.stores-user-uploaded-files-storage-the-app-resta')}
        </p>
        <p className="mt-2 select-all break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
          {storageDir}
        </p>
        {!isWebAdmin ? (
          <button
            type="button"
            onClick={() =>
              isWebAdmin ? undefined : void call(api.app.openStorageDir()).catch((error: unknown) =>
                notify('error', errorMessage(error)),
              )
            }
            className="mt-3 text-xs text-indigo-300 transition hover:text-indigo-200"
          >
            {t('admin.settings.open-in-file-manager')}
          </button>
          ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDriveIcon className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-100">{t('admin.settings.plugins-directory')}</h2>
          </div>
          <button
            type="button"
            onClick={() => void chooseDirectory('plugins')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            {t('admin.settings.change-directory')}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t('admin.settings.stores-installed-plugins-and-plugin-data-default')}
        </p>
        <p className="mt-2 select-all break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
          {pluginsDir}
        </p>
        {!isWebAdmin ? (
          <button
            type="button"
            onClick={() =>
              isWebAdmin ? undefined : void call(api.app.openPluginsDir()).catch((error: unknown) =>
                notify('error', errorMessage(error)),
              )
            }
            className="mt-3 text-xs text-indigo-300 transition hover:text-indigo-200"
          >
            {t('admin.settings.open-in-file-manager')}
          </button>
          ) : null}
      </section>

      {usageOpen ? (
        <Modal title={t('admin.settings.text-17')} onClose={() => setUsageOpen(false)} footer={<button type="button" onClick={() => setUsageOpen(false)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">{t('admin.settings.close')}</button>}>
          <div className="space-y-2 text-xs text-slate-300">
            {usageData ? ['extract', 'compress', 'scan'].map((key) => <div key={key} className="flex justify-between rounded-lg border border-slate-800 p-2"><span>{key === 'extract' ? '解压' : key === 'compress' ? '压缩' : '查杀'}</span><span>用户 {usageData[key]?.users ?? 0} / 运行 {usageData[key]?.running ?? 0} / 排队 {usageData[key]?.queued ?? 0} / 暂停 {usageData[key]?.paused ?? 0}</span></div>) : <p>加载中…</p>}
          </div>
        </Modal>
      ) : null}

      {deleteLogsConfirm ? (
        <ConfirmDialog title={t('admin.settings.delete-all-logs')} description={t('admin.settings.this-clears-runtime-logs-and-audit-logs-in-the-d')} confirmLabel={t('admin.settings.confirm-delete')} danger onClose={() => setDeleteLogsConfirm(false)} onConfirm={clearLogs} />
      ) : null}

      {resetConfirm ? (
        <ConfirmDialog title={t('admin.settings.restore-default-settings')} description={t('admin.settings.text-21')} confirmLabel={t('admin.settings.confirm-restore')} danger onClose={() => setResetConfirm(false)} onConfirm={async () => { try { const next = await call(api.settings.resetDefaults()); setSecurity(next.security); setSecurityModeSnapshot(next.security.mode); setPermissions(next.permissions); setScan(next.scan); setResetConfirm(false); notify('success',t('admin.settings.text-22')); } catch (cause) { notify('error', errorMessage(cause)); } }} />
      ) : null}
      {modeChangeConfirm ? (
        <ConfirmDialog
          title={t('admin.settings.switch-security-mode-and-clear-bans')}
          description={t('admin.settings.ip')}
          confirmLabel={t('admin.settings.confirm-switch-and-clear')}
          danger
          onClose={() => setModeChangeConfirm(false)}
          onConfirm={async () => { setModeChangeConfirm(false); await saveSecurity(true); }}
        />
      ) : null}

      {directoryChange ? (
        <Modal
          title={
            directoryChange.kind === 'data'
              ? t('admin.settings.change-system-data-directory')
              : directoryChange.kind === 'storage'
                ? t('admin.settings.change-drive-file-directory')
                : t('admin.settings.change-plugin-directory')
          }
          description={
            <div className="space-y-2">
              {isWebAdmin ? (
                <>
                  <input
                    value={directoryChange.targetPath}
                    onChange={(event) => setDirectoryChange({ ...directoryChange, targetPath: event.target.value })}
                    placeholder={t('admin.directory.placeholder')}
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <p className="text-[11px] text-slate-500">{t('admin.directory.webHint')}</p>
                </>
              ) : (
                <span className="break-all font-mono text-[11px]">{directoryChange.targetPath}</span>
              )}
            </div>
          }
          width="lg"
          onClose={directoryPending ? () => {} : () => setDirectoryChange(null)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setDirectoryChange(null)}
                disabled={directoryPending}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
              >
                {t('admin.settings.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void confirmDirectoryChange()}
                disabled={directoryPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {directoryPending ? <Spinner className="h-4 w-4" /> : null}
                {t('admin.settings.confirmAndRestart')}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                !migrate
                  ? 'border-amber-500/50 bg-amber-500/5'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="directory-migration"
                checked={!migrate}
                onChange={() => setMigrate(false)}
                disabled={directoryPending}
                className="mt-1 h-4 w-4 accent-amber-500"
              />
              <span className="text-sm leading-6 text-slate-300">
                <strong className="text-slate-100">{t('admin.settings.change-path-only-no-data-migration')}</strong>
                <br />
                {t('admin.settings.this-only-changes-the-future-storage-location-ex')}
                <span className="mt-1 block text-[11px] text-amber-300/80">
                  {directoryChange.kind === 'data'
                    ? t('admin.settings.the-new-directory-will-initialize-a-new-database')
                    : directoryChange.kind === 'storage'
                      ? t('admin.settings.text-23')
                      : t('admin.settings.the-new-directory-will-not-contain-existing-plug')}
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                migrate
                  ? 'border-indigo-500/60 bg-indigo-500/5'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="directory-migration"
                checked={migrate}
                onChange={() => setMigrate(true)}
                disabled={directoryPending}
                className="mt-1 h-4 w-4 accent-indigo-500"
              />
              <span className="text-sm leading-6 text-slate-300">
                <strong className="text-slate-100">{t('admin.settings.migrate-data-recommended')}</strong>
                <br />
                {t('admin.settings.restartDirectoryHint')}
                <span className="mt-1 block text-[11px] text-slate-500">
                  {directoryChange.kind === 'data'
                    ? t('admin.settings.copies-cloudbox-db-and-config-the-drive-file-dir')
                    : directoryChange.kind === 'storage'
                      ? t('admin.settings.copies-all-user-files-under-storage')
                      : t('admin.settings.copies-all-plugins-and-plugin-configuration-unde')}
                </span>
              </span>
            </label>

            {migrate ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-rose-900/50 bg-rose-950/20 p-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={deleteOld}
                  onChange={(event) => setDeleteOld(event.target.checked)}
                  disabled={directoryPending}
                  className="mt-1 h-4 w-4 accent-rose-500"
                />
                <span>
                  <strong className="text-slate-100">{t('admin.settings.delete-old-files-after-migration')}</strong>
                  <br />
                  {t('admin.settings.the-old-directory-will-be-deleted-before-restart')}
                </span>
              </label>
            ) : null}

            {directoryError ? (
              <div className="rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                {directoryError}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}



