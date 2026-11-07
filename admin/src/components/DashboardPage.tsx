import { useEffect, useState, type ReactNode } from 'react';
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
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [portInput, setPortInput] = useState('');
  const [togglePending, setTogglePending] = useState(false);
  const [portPending, setPortPending] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);

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

  const toggleOnline = async (): Promise<void> => {
    if (!server) return;
    setTogglePending(true);
    setPortError(null);
    try {
      const updated = await call(api.server.setOnline({ enabled: !server.running }));
      notify(
        'success',
        updated.running ? `在线模式已开启，端口 ${updated.port}` : '在线模式已关闭，服务已停止',
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
      setPortError('端口必须是 1024-65535 之间的整数');
      return;
    }

    setPortPending(true);
    setPortError(null);
    try {
      const wasRunning = server?.running ?? false;
      const updated = await call(api.server.setPort({ port }));
      notify(
        'success',
        wasRunning ? `端口已更新为 ${updated.port}，服务已重启` : `端口已保存为 ${updated.port}`,
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
                  <h2 className="text-sm font-semibold text-slate-100">本地 Web 服务</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      server?.running
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {server?.running ? '运行中' : '已停止'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {server?.running
                    ? `监听 0.0.0.0:${server.port}，局域网用户可通过浏览器访问`
                    : '当前为离线模式，不监听任何端口；管理员仍可浏览与下载用户文件'}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={server?.running ?? false}
              aria-label="在线模式"
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
              正在切换在线模式…
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
              访问地址
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
                    未检测到局域网 IPv4 地址，请确认网络连接。
                  </p>
                ) : (
                  <p className="pt-1 text-[11px] text-slate-500">
                    局域网设备需与主机处于同一网段，并允许 Windows 防火墙放行该端口。
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                打开右上角开关后生成访问地址。
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <PowerIcon className="h-4 w-4 text-indigo-400" />
            端口设置
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            修改后立即生效；在线模式下会自动重启服务，失败则回滚旧端口。
          </p>

          <label htmlFor="server-port" className="mt-4 block text-xs text-slate-400">
            监听端口（1024-65535）
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
            {server?.running ? '应用并重启服务' : '保存端口'}
          </button>
        </section>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          icon={<UsersIcon className="h-5 w-5" />}
          label="普通用户"
          value={`${regularUsers.length} 个`}
          hint={
            regularUsers.length > 0
              ? `最近登录：${formatDate(
                  regularUsers
                    .filter((user) => user.lastLoginAt !== null)
                    .sort((a, b) => (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0))[0]?.lastLoginAt ??
                    null,
                )}`
              : '尚未创建用户'
          }
        />
        <StatCard
          icon={<HardDriveIcon className="h-5 w-5" />}
          label="已用空间"
          value={formatBytes(usedBytes)}
          hint={`总配额 ${formatBytes(quotaBytes)}`}
        />
        <StatCard
          icon={<ServerIcon className="h-5 w-5" />}
          label="数据目录"
          value="本机存储"
          hint="SQLite + 用户文件"
        />
      </div>

      <section className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">数据目录</p>
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
          在资源管理器中打开
        </button>
      </section>
    </div>
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
