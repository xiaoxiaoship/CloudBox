import { useEffect, useRef, useState, type FormEvent } from 'react';
import { autoT as t } from '../i18n.ts';
import { CollapsibleSection } from './CollapsibleSection.tsx';
import type { FeaturePermissions, ScanConfig, SecurityBanEntry } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import { ConfirmDialog, Modal, type ToastState } from './Dialog.tsx';
import { SecurityPolicyPanel } from './SecurityPolicyPanel.tsx';
import { SimpleSecurityPanel } from './SimpleSecurityPanel.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { DatabaseIcon, HardDriveIcon, KeyIcon, RefreshIcon, ServerIcon, Spinner, UsersIcon } from './Icons.tsx';

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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [backupPending, setBackupPending] = useState(false);
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
  });
  const [permissionsPending, setPermissionsPending] = useState(false);
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
  });
  const [securityPending, setSecurityPending] = useState(false);
  const [securityModeSnapshot, setSecurityModeSnapshot] = useState<'simple' | 'advanced'>('simple');
  const [modeChangeConfirm, setModeChangeConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState({ maxConcurrentExtractions: 10, maxConcurrentScans: 10, maxConcurrentHeavyPreviews: 10, maxConcurrentPreviewsPerUser: 10, maxLogSizeMB: 100 });
  const [resourcesPending, setResourcesPending] = useState(false);
  const [securityUsers, setSecurityUsers] = useState<Array<{ id: number; username: string; status: string; lockedUntil: number | null; renameLimitedUntil: number | null }>>([]);
  const [rateLimits, setRateLimits] = useState<Array<{ ip: string; until: number; endpoint: string }>>([]);
  const [securityBans, setSecurityBans] = useState<SecurityBanEntry[]>([]);
  const [logs, setLogs] = useState<{ runtime: string[]; audit: unknown[] } | null>(null);
  const [logsKind, setLogsKind] = useState<'runtime' | 'audit'>('runtime');
  const [logsPending, setLogsPending] = useState(false);
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
  const [hosting, setHosting] = useState({ enabled: false, baseUrl: '' });
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
        setSecurity(settings.security);
        setSecurityModeSnapshot(settings.security.mode);
        setScan(settings.scan);
        setAi(settings.ai);
        setHosting(settings.hosting);
        setMail(settings.mail);
        setResources(settings.resources);
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
      notify('success', enabled ? '已开启用户网页自助注册' : '已关闭用户网页自助注册');
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
      notify('success', '功能权限已更新');
    } catch (cause) {
      setPermissions(previous);
      notify('error', errorMessage(cause));
    } finally {
      setPermissionsPending(false);
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

  const saveStartup = async (): Promise<void> => {
    setStartupPending(true);
    try {
      setStartup(await call(api.app.setStartup(startup)));
      notify('success', '启动与托盘设置已保存');
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
      notify('success', '管理员用户名已更新');
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
      notify('success', '账户已解锁');
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const clearRateLimit = async (ip: string): Promise<void> => {
    try {
      await call(api.system.clearRateLimit({ ip }));
      notify('success', 'IP 限流已解除');
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const clearRenameLimit = async (userId: number): Promise<void> => {
    try {
      await call(api.users.clearRenameLimit({ userId }));
      notify('success', '改名限制已解除');
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
      notify('success', '账户限制已解除');
      await refreshSecurityUsers();
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const enableSecurityUser = async (userId: number): Promise<void> => {
    try {
      await call(api.users.setStatus({ userId, status: 'active' }));
      notify('success', '账户已启用');
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
      notify('success', '网络安全设置已保存');
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
      notify('success', '配置已导出；跨版本导入可能存在兼容性问题');
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
      await call(api.settings.setResources(next.resources));
      notify('success', '配置已导入；跨版本配置可能不完全兼容');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (cause) { notify('error', errorMessage(cause)); }
  };

  const saveScan = async (): Promise<void> => {
    setScanPending(true);
    try {
      const settings = await call(api.settings.setScan(scan));
      setScan(settings.scan);
      notify('success', '安全查杀设置已保存');
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
      notify('success', 'AI 设置已保存');
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
      notify('success', '静态托管设置已保存');
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
      notify('success', '邮件通知设置已保存');
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

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }

    setChanging(true);
    setPasswordError(null);
    try {
      await call(api.auth.changePassword({ currentPassword, newPassword }));
      notify('success', '管理员密码已修改，请重新登录');
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
        notify('success', `数据库已备份：${result.fileName ?? '备份文件'}`);
      }
    } catch (cause) {
      notify('error', errorMessage(cause));
    } finally {
      setBackupPending(false);
    }
  };

  const chooseDirectory = async (kind: 'data' | 'storage' | 'plugins'): Promise<void> => {
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
      notify('success', '目录配置已更新，应用即将重启…');
      setDirectoryChange(null);
    } catch (cause) {
      setDirectoryError(errorMessage(cause));
    } finally {
      setDirectoryPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setResetConfirm(true)} className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-950/40">{t('一键恢复默认设置')}</button>
          <button type="button" onClick={() => void exportConfig()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">{t('导出配置')}</button>
          <button type="button" onClick={() => importInputRef.current?.click()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">{t('导入配置')}</button>
          <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importConfig(file); event.target.value = ''; }} />
        </div>
        <LanguageSwitcher />
      </div>
            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('管理员账户')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('管理员密码、账户信息与登录安全。')}</p>
      </div>

<CollapsibleSection>
        <div className="flex items-center gap-2">
          <KeyIcon className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-slate-100">管理员密码</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          修改后所有管理员会话会立即失效，需要使用新密码重新登录。
        </p>

        <form onSubmit={(event) => void changePassword(event)} className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="current-password">
              当前密码
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
              新密码
            </label>
            <input
              id="new-admin-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={INPUT_CLASS}
              placeholder="至少 8 位，含字母和数字"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="confirm-admin-password">
              确认新密码
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
              修改密码
            </button>
          </div>
        </form>
      </CollapsibleSection>

      <CollapsibleSection>
        <div className="flex items-center gap-2">
          <KeyIcon className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-100">管理员账户</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">管理员可在系统设置中修改自己的用户名；密码和已有文件不受影响。</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-slate-500">管理员用户名
            <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} className={`${'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-500'} min-w-64`} />
          </label>
          <button type="button" onClick={() => void saveAdminUsername()} disabled={adminRenamePending || !adminUsername.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {adminRenamePending ? <Spinner className="h-4 w-4" /> : null}
            保存用户名
          </button>
        </div>
      </CollapsibleSection>

            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('安全与运行')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('网络安全与访问保护。')}</p>
      </div>

<CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <KeyIcon className="h-4 w-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-slate-100">网络安全</h2>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">Beta</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${security.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{security.enabled ? '已开启' : '已关闭'}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {security.mode === 'simple'
                ? t('使用旧版账号锁定、IP 限流和改名限制；修改后点击保存生效。')
                : t('使用拖拽策略、全局封禁、IPS 与黑白名单；拖动下方功能到对应区域，松开即启用。')}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={security.enabled} onClick={() => setSecurity((current) => ({ ...current, enabled: !current.enabled }))} className={`relative h-7 w-12 shrink-0 rounded-full transition ${security.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${security.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="mt-4 flex gap-2 border-b border-slate-800 pb-2">
          <button type="button" onClick={() => setSecurity((current) => ({ ...current, mode: 'simple' }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${security.mode === 'simple' ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>简洁模式</button>
          <button type="button" onClick={() => setSecurity((current) => ({ ...current, mode: 'advanced' }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${security.mode === 'advanced' ? 'bg-indigo-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>高级模式</button>
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
                notify('success', '封禁已解除');
              } catch (cause) { notify('error', errorMessage(cause)); }
            }}
            onClearAccount={(userId) => void clearAccountRestriction(userId)}
            onClearIp={(ip) => void clearRateLimit(ip)}
            onRefresh={refreshSecurityUsers}
            onClearAll={async () => {
              try {
                const result = await call(api.system.clearAllSecurityBans());
                await refreshSecurityUsers();
                notify('success', `已解封并清零 ${result.removed} 条封禁`);
              } catch (cause) { notify('error', errorMessage(cause)); }
            }}
            capSettings={{ enabled: security.capEnabled, loginFailures: security.capLoginFailures, registrationLimit: security.capRegistrationLimit, shareLimit: security.capShareLimit }}
            onCapSettingsChange={(value) => setSecurity((current) => ({ ...current, capEnabled: value.enabled, capLoginFailures: value.loginFailures, capRegistrationLimit: value.registrationLimit, capShareLimit: value.shareLimit }))}
          />
          ) : null}
        </div>

        <button type="button" onClick={() => void saveSecurity()} disabled={securityPending} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {securityPending ? <Spinner className="h-4 w-4" /> : null}
          保存网络安全设置
        </button>
      </CollapsibleSection>

      <CollapsibleSection>
  <div className="flex items-center gap-2">
    <ServerIcon className="h-4 w-4 text-sky-400" />
    <h2 className="text-sm font-semibold text-slate-100">本地资源配布</h2>
  </div>
  <p className="mt-1 text-xs text-slate-500">限制解压、查杀和预览的并发量，避免单机资源被瞬时打满。</p>
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
    {([['maxConcurrentExtractions','最大同时解压任务数'],['maxConcurrentScans','最大同时查杀任务数'],['maxConcurrentHeavyPreviews','重度预览全局并发'],['maxConcurrentPreviewsPerUser','单用户预览并发'],['maxLogSizeMB','日志保存上限（MB）']] as const).map(([key,label]) => (
      <label key={key} className="text-[11px] text-slate-500">{label}
        <input type="number" min={1} max={key === 'maxLogSizeMB' ? 100000 : 1000} value={resources[key]} onChange={(event) => setResources((current) => ({ ...current, [key]: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
      </label>
    ))}
  </div>
  <div className="mt-4 flex flex-wrap gap-2">
    <button type="button" onClick={async () => { setResourcesPending(true); try { const next = await call(api.settings.setResources(resources)); setResources(next.resources); notify('success','资源配布已保存'); } catch (cause) { notify('error', errorMessage(cause)); } finally { setResourcesPending(false); } }} disabled={resourcesPending} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">{t('保存资源配布')}</button>
    <button type="button" onClick={async () => { try { const result = await call(api.settings.clearResourceCache()); notify('success', '已清理缓存，清理过期审计 ' + result.removedLogs + ' 条'); } catch (cause) { notify('error', errorMessage(cause)); } }} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">{t('清理缓存')}</button>
  </div>
</CollapsibleSection>
<section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <RefreshIcon className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-100">运行与审计日志</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">查看当前进程最近日志，或数据库中的审计记录。</p>
          </div>
          <button type="button" onClick={() => void loadLogs()} disabled={logsPending} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            {logsPending ? '加载中…' : '刷新日志'}
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {(['runtime', 'audit'] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => setLogsKind(kind)} className={`rounded-lg px-3 py-1 text-xs ${logsKind === kind ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400'}`}>
              {kind === 'runtime' ? '运行日志' : '审计日志'}
            </button>
          ))}
        </div>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-400">
          {logs
            ? logsKind === 'runtime'
              ? logs.runtime.join('\n') || '暂无运行日志'
              : JSON.stringify(logs.audit, null, 2)
            : '点击“刷新日志”加载'}
        </pre>
      </section>


            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('功能控制')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('自助注册、用户功能权限、安全查杀、AI、静态托管与邮件通知。')}</p>
      </div>

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-100">用户网页自助注册</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                allowRegistration
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {allowRegistration ? '已开启' : '已关闭'}
            </span>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={allowRegistration}
            aria-label="允许用户通过网页自助注册"
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
          默认关闭。开启后普通用户登录页会显示“没有账号？点击注册”，注册成功后立即生效，无需重启服务。
        </p>
        <p className="mt-2 text-[11px] text-slate-500">
          新注册用户角色为普通用户，状态正常，默认分配 5 GB 配额；高级模式的注册频率由注册量策略卡控制。
        </p>
        {registrationPending ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <Spinner className="h-3 w-3" />
            正在更新设置…
          </p>
        ) : null}
      </CollapsibleSection>

<CollapsibleSection>
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-100">用户功能权限</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          关闭后 Web 端会隐藏对应入口，后端接口同时返回 403。
        </p>

        <div className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800">
          {(
            [
              ['allowUserPreviewImage', '图片在线预览', '允许用户在浏览器中查看 PNG/JPG/WebP 等图片'],
              ['allowUserPreviewVideo', '视频在线播放', '允许播放 MP4/WebM/Ogg 视频'],
              ['allowUserPreviewPdf', 'PDF 在线预览', '允许在浏览器中渲染 PDF'],
              ['allowUserPreviewOffice', 'Word / Excel / PPT 预览', '允许在线预览 .docx / .xlsx / .pptx 文件'],
              ['allowUserExtract', '在线解压', '允许把 zip/7z/rar/tar.gz 解压到当前目录'],
              ['allowUserScan', '安全查杀', '允许用户对文件发起 ClamAV / VirusTotal 查杀'],
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

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-100">安全查杀</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  scan.enabled
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {scan.enabled ? '已启用' : '已关闭'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              API 模式使用 VirusTotal（文件上限 32MB）；本地模式调用配置目录中的 ClamAV 引擎。
              结果为 infected 的文件会被强制禁止下载、分享和解压。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={scan.enabled}
            aria-label="安全查杀总开关"
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
              查杀模式
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
              <option value="local">本地 ClamAV</option>
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
                placeholder="仅保存在本机数据库"
              />
            </div>
          ) : (
            <div>
              <label className="text-[11px] text-slate-500" htmlFor="scan-local-path">
                ClamAV 目录
              </label>
              <input
                id="scan-local-path"
                value={scan.localPath}
                onChange={(event) =>
                  setScan((current) => ({ ...current, localPath: event.target.value }))
                }
                className={INPUT_CLASS}
                placeholder="例如：C:\\Program Files\\ClamAV"
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
              <h2 className="text-sm font-semibold text-slate-100">AI 服务</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${ai.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {ai.enabled ? 'AI 已开启' : 'AI 已关闭'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              API Key 使用 AES-256-GCM 加密落盘，界面只显示脱敏值。
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ai.enabled}
            aria-label="AI 总开关"
            onClick={() => setAi((current) => ({ ...current, enabled: !current.enabled }))}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${ai.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${ai.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="ai-mode">AI 模式</label>
            <select id="ai-mode" value={ai.mode} onChange={(event) => setAi((current) => ({ ...current, mode: event.target.value as 'admin' | 'user' }))} className={INPUT_CLASS}>
              <option value="admin">管理员共享配置</option>
              <option value="user">用户自填配置</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500" htmlFor="ai-daily-limit">普通用户每日上限</label>
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
                <input id="ai-admin-key" type="password" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} className={INPUT_CLASS} placeholder={ai.hasApiKey ? '留空保持现有 Key' : 'sk-...'} />
              </div>
            </>
          ) : (
            <p className="md:col-span-2 rounded-lg border border-sky-900/50 bg-sky-950/20 px-3 py-2 text-xs text-sky-300">
              用户模式：管理员 Base URL / API Key 已隐藏，普通用户必须在 Web“个人设置”中填写自己的配置。
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
              <h2 className="text-sm font-semibold text-slate-100">内嵌静态托管</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${hosting.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {hosting.enabled ? '已开启' : '已关闭'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              站点统一挂载在 <code>/host/</code> 下，不额外监听端口。端口复用依赖 frp HTTP/HTTPS 隧道。
            </p>
          </div>
          <button type="button" role="switch" aria-checked={hosting.enabled} aria-label="静态托管总开关" onClick={() => setHosting((current) => ({ ...current, enabled: !current.enabled }))} className={`relative h-7 w-12 shrink-0 rounded-full transition ${hosting.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${hosting.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <label className="mt-3 block text-[11px] text-slate-500" htmlFor="hosting-base-url">公网基础地址（用于生成链接）</label>
        <input id="hosting-base-url" value={hosting.baseUrl} onChange={(event) => setHosting((current) => ({ ...current, baseUrl: event.target.value }))} className={INPUT_CLASS} placeholder="例如：https://pan.yourdomain.com" />
        <button type="button" onClick={() => void saveHosting()} disabled={hostingPending} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {hostingPending ? <Spinner className="h-4 w-4" /> : null}
          保存托管设置
        </button>
      </CollapsibleSection>

      

      <CollapsibleSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-slate-100">邮件通知</h2><span className={`rounded-full px-2 py-0.5 text-[10px] ${mail.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{mail.enabled ? '已开启' : '已关闭'}</span></div>
            <p className="mt-1 text-xs text-slate-500">SMTP 告警异步发送；密码 AES-256-GCM 加密，界面脱敏。</p>
          </div>
          <button type="button" role="switch" aria-checked={mail.enabled} aria-label="邮件总开关" onClick={() => setMail((current) => ({ ...current, enabled: !current.enabled }))} className={`relative h-7 w-12 rounded-full transition ${mail.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${mail.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-host">SMTP Host</label><input id="mail-host" value={mail.host} onChange={(e) => setMail((c) => ({ ...c, host: e.target.value }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-port">Port</label><input id="mail-port" type="number" value={mail.port} onChange={(e) => setMail((c) => ({ ...c, port: Number(e.target.value) }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-user">SMTP 用户</label><input id="mail-user" value={mail.user} onChange={(e) => setMail((c) => ({ ...c, user: e.target.value }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-pass">授权码/密码（{mail.passMasked || '未配置'}）</label><input id="mail-pass" type="password" value={mailPass} onChange={(e) => setMailPass(e.target.value)} className={INPUT_CLASS} placeholder={mail.hasPass ? '留空保持现有密码' : '请输入 QQ 邮箱授权码'} />{!mail.hasPass && mail.user ? <p className="mt-1 text-[10px] text-amber-300">未配置或无法解密，请重新填写授权码</p> : null}</div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-from">发件人</label><input id="mail-from" value={mail.from} onChange={(e) => setMail((c) => ({ ...c, from: e.target.value }))} className={INPUT_CLASS} /></div>
          <div><label className="text-[11px] text-slate-500" htmlFor="mail-to">告警接收邮箱</label><input id="mail-to" value={mail.to} onChange={(e) => setMail((c) => ({ ...c, to: e.target.value }))} className={INPUT_CLASS} /></div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={mail.secure} onChange={(e) => setMail((c) => ({ ...c, secure: e.target.checked }))} className="accent-indigo-500" />TLS（secure）</label>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.userRegistered} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, userRegistered: e.target.checked } }))} className="accent-indigo-500" />新用户注册</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.securityAlert} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, securityAlert: e.target.checked } }))} className="accent-indigo-500" />安全告警</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.securityLimit} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, securityLimit: e.target.checked } }))} className="accent-indigo-500" />{t('安全限制触发')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.resourceAlert} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, resourceAlert: e.target.checked } }))} className="accent-indigo-500" />{t('本地资源告警')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={mail.events.systemError} onChange={(e) => setMail((c) => ({ ...c, events: { ...c.events, systemError: e.target.checked } }))} className="accent-indigo-500" />系统错误</label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => void saveMail()} disabled={mailPending} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{mailPending ? '保存中…' : '保存邮件设置'}</button>
          <button type="button" onClick={() => void testMail()} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">发送测试邮件</button>
        </div>
      </CollapsibleSection>

            <div className="pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-400">{t('系统与存储')}</p>
        <p className="mt-1 text-[11px] text-slate-500">{t('启动与托盘、本地资源、运行日志、数据库备份与目录配置。')}</p>
      </div>

<CollapsibleSection>
        <div className="flex items-center gap-2">
          <HardDriveIcon className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">启动与托盘</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">控制登录 Windows 后是否自动启动 CloudBox，以及启动后是否隐藏在系统托盘。</p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300">
            <span>开机自动启动 CloudBox<br /><span className="text-[11px] text-slate-500">打包安装版生效；开发版不会注册系统启动项。</span></span>
            <input type="checkbox" checked={startup.autoStart} onChange={(event) => setStartup((current) => ({ ...current, autoStart: event.target.checked }))} className="h-4 w-4 accent-indigo-500" />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-300">
            <span>自启动后收起到系统托盘<br /><span className="text-[11px] text-slate-500">需同时开启上一项；手动启动仍显示主窗口。</span></span>
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
          <h2 className="text-sm font-semibold text-slate-100">数据库备份</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          使用 SQLite 在线备份 API 导出当前数据库（包含用户、配额、设置与审计日志）。
        </p>

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
            <h2 className="text-sm font-semibold text-slate-100">系统数据目录</h2>
          </div>
          <button
            type="button"
            onClick={() => void chooseDirectory('data')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            更改目录
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          存放 cloudbox.db、SSL 证书、CA 与 frp 配置。
        </p>
        <p className="mt-2 select-all break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
          {dataDir}
        </p>
        <button
          type="button"
          onClick={() =>
            void call(api.app.openDataDir()).catch((error: unknown) =>
              notify('error', errorMessage(error)),
            )
          }
          className="mt-3 text-xs text-indigo-300 transition hover:text-indigo-200"
        >
          在资源管理器中打开
        </button>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDriveIcon className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">网盘文件目录</h2>
          </div>
          <button
            type="button"
            onClick={() => void chooseDirectory('storage')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            更改目录
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          存放所有用户上传的文件（storage）。修改后应用会重启。
        </p>
        <p className="mt-2 select-all break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
          {storageDir}
        </p>
        <button
          type="button"
          onClick={() =>
            void call(api.app.openStorageDir()).catch((error: unknown) =>
              notify('error', errorMessage(error)),
            )
          }
          className="mt-3 text-xs text-indigo-300 transition hover:text-indigo-200"
        >
          在资源管理器中打开
        </button>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDriveIcon className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-100">插件目录</h2>
          </div>
          <button
            type="button"
            onClick={() => void chooseDirectory('plugins')}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            更改目录
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          存放已安装插件与插件专属配置（默认 %APPDATA%/CloudBox/plugins）。修改后应用会重启。
        </p>
        <p className="mt-2 select-all break-all rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-slate-400">
          {pluginsDir}
        </p>
        <button
          type="button"
          onClick={() =>
            void call(api.app.openPluginsDir()).catch((error: unknown) =>
              notify('error', errorMessage(error)),
            )
          }
          className="mt-3 text-xs text-indigo-300 transition hover:text-indigo-200"
        >
          在资源管理器中打开
        </button>
      </section>

      {resetConfirm ? (
        <ConfirmDialog title="恢复默认设置？" description="将重置安全、查杀、权限、邮件、资源配布等配置，并清除当前封禁和计数；不会删除用户、文件或数据库。" confirmLabel="确认恢复" danger onClose={() => setResetConfirm(false)} onConfirm={async () => { try { const next = await call(api.settings.resetDefaults()); setSecurity(next.security); setSecurityModeSnapshot(next.security.mode); setResources(next.resources); setPermissions(next.permissions); setScan(next.scan); setResetConfirm(false); notify('success','已恢复默认设置'); } catch (cause) { notify('error', errorMessage(cause)); } }} />
      ) : null}
      {modeChangeConfirm ? (
        <ConfirmDialog
          title="切换安全模式并清除封禁？"
          description="切换简洁/高级模式会清空当前封禁、旧锁定、计数、策略重置时间和 IP 限流记录。此操作不可撤销。"
          confirmLabel="确认切换并清除"
          danger
          onClose={() => setModeChangeConfirm(false)}
          onConfirm={async () => { setModeChangeConfirm(false); await saveSecurity(true); }}
        />
      ) : null}

      {directoryChange ? (
        <Modal
          title={
            directoryChange.kind === 'data'
              ? '更改系统数据目录'
              : directoryChange.kind === 'storage'
                ? '更改网盘文件目录'
                : '更改插件目录'
          }
          description={
            <span className="break-all font-mono text-[11px]">
              {directoryChange.targetPath}
            </span>
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
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDirectoryChange()}
                disabled={directoryPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {directoryPending ? <Spinner className="h-4 w-4" /> : null}
                确认并重启
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
                <strong className="text-slate-100">仅改路径（不迁移数据）</strong>
                <br />
                此操作只会改变未来的存储位置。原目录中的已有数据不会移动。原有文件将暂时无法在系统中看到，需手动搬移。
                <span className="mt-1 block text-[11px] text-amber-300/80">
                  {directoryChange.kind === 'data'
                    ? '新目录会初始化全新数据库，需要重新创建管理员。'
                    : directoryChange.kind === 'storage'
                      ? '目标目录会按现有用户初始化空子目录。'
                      : '新目录不会包含现有插件，需要重新导入。'}
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
                <strong className="text-slate-100">迁移数据（推荐）</strong>
                <br />
                服务将暂停，把现有所有数据复制到新目录。请勿关闭软件。
                <span className="mt-1 block text-[11px] text-slate-500">
                  {directoryChange.kind === 'data'
                    ? '会复制 cloudbox.db 与 config；网盘文件目录保持不变，可单独迁移。'
                    : directoryChange.kind === 'storage'
                      ? '会复制 storage 下所有用户文件。'
                      : '会复制 plugins 下所有插件及插件配置。'}
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
                  <strong className="text-slate-100">迁移完成后删除旧文件</strong>
                  <br />
                  应用重启前会删除原目录。请确认新目录已完整复制；此操作不可撤销。
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
