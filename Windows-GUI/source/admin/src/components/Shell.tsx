import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminStatus, AdminUser, ServerStatus } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import type { PageKey } from '../App.tsx';
import type { ToastState } from './Dialog.tsx';
import {
  CloudIcon,
  DashboardIcon,
  FolderIcon,
  LogoutIcon,
  PlugIcon,
  ServerIcon,
  SettingsIcon,
  Spinner,
  UsersIcon,
  WifiIcon,
} from './Icons.tsx';
import { DashboardPage } from './DashboardPage.tsx';
import { FilesPage } from './FilesPage.tsx';
import { NetworkPage } from './NetworkPage.tsx';
import { PluginsPage } from './PluginsPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { UpdateDialog } from './UpdateDialog.tsx';
import { UsersPage } from './UsersPage.tsx';

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: typeof DashboardIcon }> = [
  { key: 'dashboard', label: 'nav.dashboard', icon: DashboardIcon },
  { key: 'users', label: 'nav.users', icon: UsersIcon },
  { key: 'files', label: 'nav.files', icon: FolderIcon },
  { key: 'network', label: 'nav.network', icon: WifiIcon },
  { key: 'plugins', label: 'nav.plugins', icon: PlugIcon },
  { key: 'settings', label: 'nav.settings', icon: SettingsIcon },
];

const PAGE_TITLES: Record<PageKey, string> = {
  dashboard: 'nav.dashboard',
  users: 'nav.users',
  files: 'nav.files',
  network: 'nav.network',
  plugins: 'nav.plugins',
  settings: 'nav.settings',
};

interface ShellProps {
  status: AdminStatus;
  user: AdminUser;
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  onLogout: () => Promise<void>;
  notify: (kind: ToastState['kind'], message: string) => void;
}

export function Shell({ status, user, page, onNavigate, onLogout, notify }: ShellProps) {
  const { t } = useTranslation();
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [speed, setSpeed] = useState({ up: 0, down: 0 });
  const lastTraffic = useRef<{ time: number; up: number; down: number } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  const refreshServer = useCallback(async (): Promise<void> => {
    try {
      const next = await call(api.server.status());
      const now = Date.now();
      if (lastTraffic.current !== null && next.running) {
        const elapsed = Math.max(0.001, (now - lastTraffic.current.time) / 1000);
        setSpeed({
          up: Math.max(0, (next.uploadedBytes - lastTraffic.current.up) / elapsed),
          down: Math.max(0, (next.downloadedBytes - lastTraffic.current.down) / elapsed),
        });
      } else {
        setSpeed({ up: 0, down: 0 });
      }
      lastTraffic.current = next.running
        ? { time: now, up: next.uploadedBytes, down: next.downloadedBytes }
        : null;
      setServer(next);
    } catch {
      // 后台轮询失败不打扰用户
    }
  }, []);

  useEffect(() => {
    void call(api.system.checkUpdate())
      .then((result) => setUpdateAvailable(result.hasUpdate))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshServer();
    const timer = window.setInterval(() => {
      void refreshServer();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [refreshServer]);

  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-950/60">
            <CloudIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">CloudBox</p>
            <p className="text-[10px] text-slate-500">{t('admin.shell.brandSubtitle')}</p>
          </div>
        </div>

        <nav className="mt-2 flex-1 space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = page === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${
                  active
                    ? 'border border-indigo-500/30 bg-indigo-500/15 text-indigo-200'
                    : 'border border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{t(item.label)}</span>
                {item.key === 'settings' && updateAvailable ? <span className="h-2 w-2 rounded-full bg-rose-500" aria-label={t('admin.shell.newVersion')} /> : null}
              </button>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-slate-800 px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2.5 py-2">
            <span
              className={`h-2 w-2 rounded-full ${
                server?.running ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span className="text-[11px] text-slate-400">
              {server?.running
                ? t('admin.shell.onlineRate', { up: formatRate(speed.up), down: formatRate(speed.down) })
                : t('admin.shell.offline')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              void call(api.app.openDataDir()).catch((error: unknown) =>
                notify('error', errorMessage(error)),
              );
            }}
            className="w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[11px] text-slate-500 transition hover:bg-slate-900 hover:text-slate-300"
            title={status.dataDir}
          >
            {t('admin.shell.dataDirectory')}
          </button>

          <div className="flex items-center justify-between px-2 text-[10px] text-slate-600">
            <span>v{status.version}</span>
            <button type="button" onClick={() => setUpdateOpen(true)} className="text-[10px] text-indigo-400 hover:text-indigo-300">
              {t('admin.shell.updateAbout')}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/30 px-6">
          <div>
            <h1 className="text-sm font-semibold text-slate-100">{t(PAGE_TITLES[page])}</h1>
            <p className="text-[11px] text-slate-500">
              {server?.running ? t('admin.shell.serviceRunning') : t('admin.shell.serviceStopped')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">
              <ServerIcon className="h-3.5 w-3.5" />
              {server?.running ? t('admin.shell.online') : t('admin.shell.offline')}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-[11px] font-semibold text-white">
                {(user.displayName || user.username).slice(0, 1).toUpperCase()}
              </div>
              <span className="text-xs text-slate-300">{user.username}</span>
            </div>

            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
            >
              {loggingOut ? <Spinner className="h-3.5 w-3.5" /> : <LogoutIcon className="h-3.5 w-3.5" />}
              退出
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {page === 'dashboard' ? (
            <DashboardPage
              server={server}
              dataDir={status.dataDir}
              refreshServer={refreshServer}
              notify={notify}
            />
          ) : null}
          {page === 'users' ? <UsersPage notify={notify} /> : null}
          {page === 'files' ? <FilesPage notify={notify} /> : null}
          {page === 'network' ? (
            <NetworkPage server={server} refreshServer={refreshServer} notify={notify} />
          ) : null}
          {page === 'plugins' ? <PluginsPage notify={notify} /> : null}
          {page === 'settings' ? (
            <SettingsPage
              dataDir={status.dataDir}
              storageDir={status.storageDir}
              pluginsDir={status.pluginsDir}
              notify={notify}
              onPasswordChanged={onLogout}
            />
          ) : null}
        </main>
      </div>
    </div>
    {updateOpen ? (
      <UpdateDialog
        currentVersion={status.version}
        onClose={() => setUpdateOpen(false)}
        onFoundUpdate={() => setUpdateAvailable(true)}
      />
    ) : null}
    </>
  );
}

function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}
