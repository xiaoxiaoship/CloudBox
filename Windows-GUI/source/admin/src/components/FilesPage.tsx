import { useCallback, useEffect, useState } from 'react';
import type { FileEntryDto, FileListingDto, UserSummary } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
import type { ToastState } from './Dialog.tsx';
import {
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  HardDriveIcon,
  RefreshIcon,
  Spinner,
  UsersIcon,
} from './Icons.tsx';
import { formatBytes, formatDate } from '../lib/format.ts';

interface FilesPageProps {
  notify: (kind: ToastState['kind'], message: string) => void;
}

export function FilesPage({ notify }: FilesPageProps) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<FileListingDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await call(api.users.list());
        setUsers(list);
        if (list.length > 0) {
          setSelectedUserId((current) => current ?? list[0]!.id);
        }
      } catch (cause) {
        setError(errorMessage(cause));
      }
    })();
  }, []);

  const load = useCallback(
    async (userId: number, targetPath: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        setListing(await call(api.files.list({ userId, path: targetPath })));
      } catch (cause) {
        setError(errorMessage(cause));
        setListing(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedUserId === null) return;
    void load(selectedUserId, path);
  }, [selectedUserId, path, load]);

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const segments = path === '' ? [] : path.split('/');

  const download = async (entry: FileEntryDto): Promise<void> => {
    if (selectedUserId === null) return;
    try {
      const result = await call(api.files.download({ userId: selectedUserId, path: entry.path }));
      if (result.saved) {
        notify('success', `已保存：${result.fileName ?? entry.name}`);
      }
    } catch (cause) {
      notify('error', errorMessage(cause));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">用户文件（只读）</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            管理员可直接浏览所有用户目录并下载文件，所有路径强制经过 safePath 校验
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5">
            <UsersIcon className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={selectedUserId ?? ''}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPath('');
                setSelectedUserId(Number.isFinite(next) && next > 0 ? next : null);
              }}
              className="bg-transparent text-xs text-slate-200 outline-none"
              aria-label="选择用户"
            >
              {users.length === 0 ? <option value="">暂无用户</option> : null}
              {users.map((user) => (
                <option key={user.id} value={user.id} className="bg-slate-900">
                  {user.username}
                  {user.role === 'admin' ? '（管理员）' : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              if (selectedUserId !== null) void load(selectedUserId, path);
            }}
            disabled={selectedUserId === null || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setPath('')}
              className={`rounded px-1.5 py-0.5 transition hover:bg-slate-800 ${
                segments.length === 0 ? 'font-medium text-slate-100' : 'text-slate-400'
              }`}
            >
              根目录
            </button>
            {segments.map((segment, index) => {
              const target = segments.slice(0, index + 1).join('/');
              return (
                <span key={target} className="flex items-center gap-1">
                  <ChevronRightIcon className="h-3 w-3 text-slate-600" />
                  <button
                    type="button"
                    onClick={() => setPath(target)}
                    className={`max-w-[10rem] truncate rounded px-1.5 py-0.5 transition hover:bg-slate-800 ${
                      index === segments.length - 1
                        ? 'font-medium text-slate-100'
                        : 'text-slate-400'
                    }`}
                    title={segment}
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-500">
            <HardDriveIcon className="h-3 w-3" />
            只读模式
          </div>
        </div>

        {error ? (
          <div className="border-b border-rose-900/50 bg-rose-950/20 px-4 py-2 text-xs text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/40 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 text-right font-medium">大小</th>
                <th className="px-4 py-2.5 text-right font-medium">修改时间</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loading && listing === null ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-xs text-slate-500">
                    <Spinner className="mx-auto mb-2 h-5 w-5 text-indigo-400" />
                    正在读取目录…
                  </td>
                </tr>
              ) : listing === null || listing.entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <FolderIcon className="mx-auto h-8 w-8 text-slate-700" />
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedUser ? '该目录为空' : '请选择一个用户'}
                    </p>
                  </td>
                </tr>
              ) : (
                listing.entries.map((entry) => (
                  <tr key={entry.path} className="transition hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.type === 'dir') setPath(entry.path);
                          else void download(entry);
                        }}
                        className="flex items-center gap-2.5 text-left text-slate-200 transition hover:text-indigo-300"
                        title={entry.type === 'dir' ? '进入目录' : '下载文件'}
                      >
                        {entry.type === 'dir' ? (
                          <FolderIcon className="h-4 w-4 text-amber-400" />
                        ) : (
                          <FileIcon className="h-4 w-4 text-slate-500" />
                        )}
                        <span className="max-w-[26rem] truncate">{entry.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                      {entry.type === 'dir' ? '—' : formatBytes(entry.size)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                      {formatDate(entry.modifiedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {entry.type === 'file' ? (
                        <button
                          type="button"
                          onClick={() => void download(entry)}
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
                          aria-label={`下载 ${entry.name}`}
                          title="下载"
                        >
                          <DownloadIcon className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {listing?.truncated ? (
          <p className="border-t border-amber-900/50 bg-amber-950/20 px-4 py-2 text-[11px] text-amber-300">
            目录项超过 5000，已截断显示。
          </p>
        ) : null}
      </div>

      {selectedUser ? (
        <p className="text-center text-[11px] text-slate-600">
          当前用户：{selectedUser.username} · 已用 {formatBytes(selectedUser.usedBytes)}
          {selectedUser.quotaBytes === null ? ' · 不限量' : ` / ${formatBytes(selectedUser.quotaBytes)}`}
        </p>
      ) : null}
    </div>
  );
}
