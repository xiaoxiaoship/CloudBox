import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  api,
  guestDownloadUrl,
  type FileListing,
  type GuestPublicInfo,
} from '../api/client.ts';
import { applyTheme, readStoredTheme } from '../lib/theme.ts';
import { formatBytes, formatDate } from '../lib/format.ts';
import { Breadcrumbs } from './Breadcrumbs.tsx';
import { AlertIcon, CloudIcon, FileIcon, FolderIcon, RefreshIcon, Spinner } from './Icons.tsx';

type GuestPhase = 'loading' | 'locked' | 'ready' | 'blocked';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'GUEST_DISABLED':
        return '管理员已关闭访客模式';
      case 'GUEST_LINK_NOT_FOUND':
        return '访客链接不存在或已被撤销';
      case 'GUEST_LINK_EXPIRED':
        return '访客链接已过期，请联系分享者重新生成链接';
      case 'GUEST_PASSWORD_INVALID':
        return error.status === 429 ? '访问密码不正确，请稍后再试' : error.message;
      case 'GUEST_TOO_MANY_SESSIONS':
        return '当前访客人数已达上限，请稍后再试';
      case 'GUEST_SESSION_INVALID':
        return '访客会话已过期，请重新进入';
      case 'GUEST_USER_INVALID':
        return '访客链接对应的账号不可用';
      case 'SECURITY_BANNED':
        return '尝试次数过多，已被临时限制，请稍后再试';
      case 'RATE_LIMITED':
      case 'guestRateLimit':
        return '请求过于频繁，请稍后再试';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : '加载失败，请稍后重试';
}

function isFatal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ['GUEST_DISABLED', 'GUEST_LINK_NOT_FOUND', 'GUEST_LINK_EXPIRED', 'GUEST_USER_INVALID'].includes(
      error.code,
    )
  );
}

/**
 * 独立访客页：/guest/:token。
 * 不依赖登录 store、不渲染任何上传/删除/改名/分享入口，只做只读浏览与下载。
 */
export default function GuestPage({ token }: { token: string }) {
  const [phase, setPhase] = useState<GuestPhase>('loading');
  const [info, setInfo] = useState<GuestPublicInfo | null>(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [listingLoading, setListingLoading] = useState(false);

  useEffect(() => {
    applyTheme(readStoredTheme());
    document.title = '访客访问 - CloudBox';
  }, []);

  const loadFiles = useCallback(
    async (path: string): Promise<void> => {
      setListingLoading(true);
      setMessage(null);
      try {
        const result = await api.guestFiles(token, path);
        setListing(result);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setPhase('locked');
          setMessage('访客会话已过期，请重新进入');
          return;
        }
        if (isFatal(error)) {
          setPhase('blocked');
        }
        setMessage(errorText(error));
      } finally {
        setListingLoading(false);
      }
    },
    [token],
  );

  const enter = useCallback(
    async (value: string): Promise<void> => {
      setUnlocking(true);
      setMessage(null);
      try {
        await api.guestUnlock(token, value);
        setPhase('ready');
        await loadFiles('');
      } catch (error) {
        if (isFatal(error)) {
          setPhase('blocked');
        }
        setMessage(errorText(error));
      } finally {
        setUnlocking(false);
      }
    },
    [token, loadFiles],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await api.guestInfo(token);
        if (cancelled) return;
        setInfo(loaded);

        if (loaded.hasPassword) {
          setPhase('locked');
          return;
        }

        // 无密码链接自动 unlock
        await api.guestUnlock(token, '');
        if (cancelled) return;
        setPhase('ready');
        await loadFiles('');
      } catch (error) {
        if (cancelled) return;
        setPhase(isFatal(error) ? 'blocked' : 'locked');
        setMessage(errorText(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, loadFiles]);

  const refresh = (): void => {
    void loadFiles(listing?.path ?? '');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <CloudIcon className="h-5 w-5" />
            </div>
            <span className="truncate text-base font-semibold tracking-tight">CloudBox</span>
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              访客访问 · 只读
            </span>
          </div>
          {info ? (
            <span className="max-w-[12rem] truncate text-xs text-slate-500 dark:text-slate-400" title={info.ownerUsername}>
              {info.ownerUsername} 的网盘
            </span>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        {phase === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-sm text-slate-500 dark:text-slate-400">
            <Spinner className="h-6 w-6 text-indigo-500" />
            正在加载访客链接…
          </div>
        ) : null}

        {phase === 'blocked' ? (
          <section className="rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm dark:border-rose-900/60 dark:bg-slate-900">
            <AlertIcon className="mx-auto h-8 w-8 text-rose-500" />
            <h1 className="mt-3 text-base font-semibold">无法访问</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message ?? '访客链接不可用'}</p>
          </section>
        ) : null}

        {phase === 'locked' ? (
          <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h1 className="text-base font-semibold">访问 {info?.ownerUsername ?? '对方'} 的共享文件</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              访客只能预览文件列表与下载文件，无法修改任何内容。
            </p>
            {info ? (
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                {info.expiresAt === 0 ? '链接永久有效' : `链接有效期至 ${new Date(info.expiresAt).toLocaleString('zh-CN')}`}
              </p>
            ) : null}

            {info?.hasPassword ? (
              <form
                className="mt-5 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (unlocking) return;
                  void enter(password);
                }}
              >
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  访问密码
                  <input
                    type="password"
                    value={password}
                    autoFocus
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:border-indigo-400 dark:focus:ring-indigo-950/60"
                    placeholder="请输入分享者设置的密码"
                  />
                </label>
                <button
                  type="submit"
                  disabled={unlocking || password === ''}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
                >
                  {unlocking ? <Spinner className="h-4 w-4" /> : null}
                  进入
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => void enter('')}
                disabled={unlocking}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                {unlocking ? <Spinner className="h-4 w-4" /> : null}
                继续访问
              </button>
            )}

            {message ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}

        {phase === 'ready' ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Breadcrumbs path={listing?.path ?? ''} disabled={listingLoading} onNavigate={(path) => void loadFiles(path)} />
              <button
                type="button"
                onClick={refresh}
                disabled={listingLoading}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
                title="刷新"
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${listingLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-slate-100 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500 sm:grid-cols-[1fr_6rem_9rem_4.5rem]">
                <span>名称</span>
                <span className="hidden justify-self-end sm:block">大小</span>
                <span className="hidden justify-self-end sm:block">修改时间</span>
                <span className="justify-self-end">操作</span>
              </div>

              {listingLoading && listing === null ? (
                <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-500 dark:text-slate-400">
                  <Spinner className="h-5 w-5 text-indigo-500" />
                  正在读取目录…
                </div>
              ) : null}

              {listing !== null && listing.entries.length === 0 && !listingLoading ? (
                <div className="px-4 py-16 text-center text-sm text-slate-400 dark:text-slate-500">此文件夹为空</div>
              ) : null}

              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {listing?.entries.map((entry) => (
                  <li key={entry.path}>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-2.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:grid-cols-[1fr_6rem_9rem_4.5rem]">
                      {entry.type === 'dir' ? (
                        <button
                          type="button"
                          onClick={() => void loadFiles(entry.path)}
                          disabled={listingLoading}
                          className="flex min-w-0 items-center gap-2 text-left text-slate-700 transition hover:text-indigo-600 disabled:opacity-60 dark:text-slate-200 dark:hover:text-indigo-400"
                          title={entry.name}
                        >
                          <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
                          <span className="truncate">{entry.name}</span>
                        </button>
                      ) : (
                        <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200" title={entry.name}>
                          <FileIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                          <span className="truncate">{entry.name}</span>
                        </span>
                      )}

                      <span className="hidden justify-self-end text-xs text-slate-500 dark:text-slate-400 sm:block">
                        {entry.type === 'dir' ? '—' : formatBytes(entry.size)}
                      </span>

                      <span className="hidden justify-self-end text-xs text-slate-500 dark:text-slate-400 sm:block">
                        {formatDate(entry.modifiedAt)}
                      </span>

                      <span className="justify-self-end">
                        {entry.type === 'file' ? (
                          <a
                            href={guestDownloadUrl(token, entry.path)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:text-indigo-400"
                            title={`下载 ${entry.name}`}
                          >
                            下载
                          </a>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              {listing?.truncated ? (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-600 dark:border-slate-800 dark:text-amber-400">
                  目录条目过多，仅显示前 {listing.entries.length} 项
                </p>
              ) : null}
            </div>

            <p className="text-center text-xs text-slate-400 dark:text-slate-500">
              访客只能预览与下载，任何上传、删除、改名、分享或压缩操作均不可用。
            </p>

            {message ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
