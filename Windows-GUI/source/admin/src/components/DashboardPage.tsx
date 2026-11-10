import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerStatus, UserSummary } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import type { ToastState } from './Dialog.tsx';
import {
  AlertIcon,
  HardDriveIcon,
  PowerIcon,
  RefreshIcon,
  ServerIcon,
  Spinner,
  UsersIcon,
} from './Icons.tsx';
import { formatBytes, formatDate } from '../lib/format.ts';

interface DashboardPageProps {
  server: ServerStatus | null;
  dataDir: string;
  refreshServer: () => Promise<void>;
  notify: (kind: ToastState['kind'], message: string) => void;
}

export function DashboardPage({ server, dataDir, refreshServer, notify }: DashboardPageProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [portInput, setPortInput] = useState('');
  const [togglePending, setTogglePending] = useState(false);
  const [portPending, setPortPending] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<Array<{ up: number; down: number }>>(() =>
    Array.from({ length: 60 }, () => ({ up: 0, down: 0 })),
  );
  const lastTraffic = useRef<{ time: number; up: number; down: number } | null>(null);
  const serverRef = useRef<ServerStatus | null>(server);
  serverRef.current = server;

  useEffect(() => {
    void (async () => {
      try {
        setUsers(await call(api.users.list()));
      } catch {
        // 概览统计失败不影响主功能
      }
    })();
  }, []);

  useEffect(() => {
    if (server) setPortInput(String(server.port));
  }, [server?.port]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = serverRef.current;
      if (!current?.running) {
        lastTraffic.current = null;
        setTraffic(Array.from({ length: 60 }, () => ({ up: 0, down: 0 })));
        return;
      }
      const now = Date.now();
      const previous = lastTraffic.current;
      if (previous) {
        const elapsed = Math.max(0.5, (now - previous.time) / 1000);
        const sample = {
          up: Math.max(0, (current.uploadedBytes - previous.up) / elapsed),
          down: Math.max(0, (current.downloadedBytes - previous.down) / elapsed),
        };
        setTraffic((points) => [...points.slice(1), sample]);
      }
      lastTraffic.current = { time: now, up: current.uploadedBytes, down: current.downloadedBytes };
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const toggleOnline = async (): Promise<void> => {
    if (!server) return;
    setTogglePending(true);
    setPortError(null);
    try {
      const updated = await call(api.server.setOnline({ enabled: !server.running }));
      notify(
        'success',
        updated.running
          ? t('admin.dashboard.onlineOn', { port: updated.port })
          : t('admin.dashboard.onlineOff'),
      );
      await refreshServer();
    } catch (error) {
      notify('error', errorMessage(error));
      await refreshServer();
    } finally {
      setTogglePending(false);
    }
  };

  const savePort = async (): Promise<void> => {
    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      setPortError(t('admin.dashboard.portInvalid'));
      return;
    }

    setPortPending(true);
    setPortError(null);
    try {
      const wasRunning = server?.running ?? false;
      const updated = await call(api.server.setPort({ port }));
      notify(
        'success',
        wasRunning
          ? t('admin.dashboard.portUpdated', { port: updated.port })
          : t('admin.dashboard.portSaved', { port: updated.port }),
      );
      await refreshServer();
    } catch (error) {
      setPortError(errorMessage(error));
      await refreshServer();
    } finally {
      setPortPending(false);
    }
  };

  const regularUsers = users.filter((user) => user.role === 'user');
  const usedBytes = users.reduce((sum, user) => sum + user.usedBytes, 0);
  const quotaBytes = users.reduce(
    (sum, user) => (user.quotaBytes === null ? sum : sum + user.quotaBytes),
    0,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <TrafficPanel traffic={traffic} server={server} />
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  server?.running
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <ServerIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-100">{t('admin.dashboard.localWebService')}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      server?.running
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {server?.running ? t('admin.dashboard.running') : t('admin.dashboard.stopped')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {server?.running
                    ? t('admin.dashboard.listening', { port: server.port })
                    : t('admin.dashboard.offlineHint')}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={server?.running ?? false}
              aria-label={t('admin.dashboard.onlineMode')}
              disabled={togglePending || server === null}
              onClick={() => void toggleOnline()}
              className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition ${
                server?.running ? 'bg-emerald-500' : 'bg-slate-700'
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  server?.running ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {togglePending ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-400">
              <Spinner className="h-3.5 w-3.5" />
              {t('admin.dashboard.toggling')}
            </div>
          ) : null}

          {server?.error ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {server.error}
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {t('admin.dashboard.accessUrls')}
            </p>
            {server?.running ? (
              <div className="mt-2 space-y-1.5">
                <code className="block select-all rounded-md bg-slate-900 px-2 py-1.5 text-xs text-indigo-300">
                  http://127.0.0.1:{server.port}
                </code>
                {server.urls.map((url) => (
                  <code
                    key={url}
                    className="block select-all rounded-md bg-slate-900 px-2 py-1.5 text-xs text-sky-300"
                  >
                    {url}
                  </code>
                ))}
                {server.urls.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {t('admin.dashboard.noLanIpv4')}
                  </p>
                ) : (
                  <p className="pt-1 text-[11px] text-slate-500">
                    {t('admin.dashboard.lanHint')}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                {t('admin.dashboard.onlineHint')}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <PowerIcon className="h-4 w-4 text-indigo-400" />
            {t('admin.dashboard.portSettings')}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t('admin.dashboard.portHint')}
          </p>

          <label htmlFor="server-port" className="mt-4 block text-xs text-slate-400">
            {t('admin.dashboard.listenPort')}
          </label>
          <input
            id="server-port"
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={(event) => setPortInput(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-950"
          />

          {portError ? <p className="mt-2 text-xs text-rose-400">{portError}</p> : null}

          <button
            type="button"
            onClick={() => void savePort()}
            disabled={portPending || !portInput}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {portPending ? <Spinner className="h-4 w-4" /> : null}
            {server?.running ? t('admin.dashboard.applyRestart') : t('admin.dashboard.savePort')}
          </button>
        </section>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          icon={<UsersIcon className="h-5 w-5" />}
          label={t('admin.dashboard.regularUsers')}
          value={t('admin.dashboard.usersCount', { count: regularUsers.length })}
          hint={
            regularUsers.length > 0
              ? t('admin.dashboard.lastLogin', {
                  time: formatDate(
                    regularUsers
                      .filter((user) => user.lastLoginAt !== null)
                      .sort((a, b) => (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0))[0]?.lastLoginAt ??
                      null,
                  ),
                })
              : t('admin.dashboard.noUsers')
          }
        />
        <StatCard
          icon={<HardDriveIcon className="h-5 w-5" />}
          label={t('admin.dashboard.usedSpace')}
          value={formatBytes(usedBytes)}
          hint={t('admin.dashboard.quotaTotal', { size: formatBytes(quotaBytes) })}
        />
        <StatCard
          icon={<ServerIcon className="h-5 w-5" />}
          label={t('admin.dashboard.dataDirectory')}
          value={t('admin.dashboard.localStorage')}
          hint={t('admin.dashboard.sqliteFiles')}
        />
      </div>

      <section className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">{t('admin.dashboard.dataDirectory')}</p>
          <p className="mt-1 select-all truncate text-xs text-slate-500">{dataDir}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            void call(api.app.openDataDir()).catch((error: unknown) =>
              notify('error', errorMessage(error)),
            )
          }
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          {t('admin.dashboard.openInExplorer')}
        </button>
      </section>
    </div>
  );
}

function formatRate(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytes)} B/s`;
}

function TrafficPanel({ traffic, server }: { traffic: Array<{ up: number; down: number }>; server: ServerStatus | null }) {
  const { t } = useTranslation();
  const width = 760;
  const height = 150;
  const max = Math.max(1024, ...traffic.flatMap((point) => [point.up, point.down]));
  const points = (key: 'up' | 'down'): string => traffic.map((point, index) => {
    const x = (index / Math.max(1, traffic.length - 1)) * width;
    const y = height - (point[key] / max) * (height - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = (key: 'up' | 'down'): string => `0,${height} ${points(key)} ${width},${height}`;
  const current = traffic.at(-1) ?? { up: 0, down: 0 };
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{t('admin.dashboard.realtimeTraffic')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('admin.dashboard.trafficHint')}</p>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="text-sky-300">{t('admin.dashboard.uploadRate', { rate: formatRate(current.up) })}</span>
          <span className="text-emerald-300">{t('admin.dashboard.downloadRate', { rate: formatRate(current.down) })}</span>
        </div>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl bg-slate-950/70 p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" role="img" aria-label={t('admin.dashboard.trafficChart')}>
          {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" y1={height * ratio} x2={width} y2={height * ratio} stroke="currentColor" className="text-slate-800/70" />)}
          <polygon points={area("down")} fill="currentColor" className="text-emerald-500/10" />
          <polygon points={area("up")} fill="currentColor" className="text-sky-500/10" />
          <polyline points={points("up")} fill="none" stroke="currentColor" strokeWidth="2" className="text-sky-400" />
          <polyline points={points("down")} fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400" />
          <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="currentColor" className="text-slate-800" />
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{t('admin.dashboard.totalTraffic', {
          up: server ? formatBytes(server.uploadedBytes) : '-',
          down: server ? formatBytes(server.downloadedBytes) : '-',
        })}</p>
    </section>
  );
}
function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-100">{value}</p>
      <p className="mt-1 truncate text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
