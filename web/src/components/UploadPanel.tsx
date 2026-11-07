import { useAppStore } from '../store/useAppStore.ts';
import { formatBytes } from '../lib/format.ts';
import { AlertIcon, CheckIcon, Spinner, UploadIcon, XIcon } from './Icons.tsx';

export function UploadPanel() {
  const uploads = useAppStore((state) => state.uploads);
  const cancelUpload = useAppStore((state) => state.cancelUpload);
  const clearFinishedUploads = useAppStore((state) => state.clearFinishedUploads);

  if (uploads.length === 0) return null;

  const finished = uploads.filter((item) => item.status !== 'uploading').length;

  return (
    <section
      aria-label="上传任务"
      className="fixed inset-x-3 bottom-3 z-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-96"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <UploadIcon className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          上传任务
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {uploads.length}
          </span>
        </div>
        {finished > 0 ? (
          <button
            type="button"
            onClick={clearFinishedUploads}
            className="text-xs text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            清除已完成
          </button>
        ) : null}
      </div>

      <ul className="max-h-64 divide-y divide-slate-50 overflow-y-auto dark:divide-slate-800/70">
        {uploads.map((item) => (
          <li key={item.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="shrink-0">
                {item.status === 'uploading' ? (
                  <Spinner className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                ) : item.status === 'success' ? (
                  <CheckIcon className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                ) : item.status === 'canceled' ? (
                  <XIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                ) : (
                  <AlertIcon className="h-4 w-4 text-rose-500 dark:text-rose-400" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className="truncate text-xs font-medium text-slate-700 dark:text-slate-200"
                    title={item.name}
                  >
                    {item.name}
                  </p>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                    {item.status === 'uploading'
                      ? `${Math.round(item.progress * 100)}%`
                      : item.status === 'success'
                        ? '完成'
                        : item.status === 'canceled'
                          ? '已取消'
                          : '失败'}
                  </span>
                </div>

                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      item.status === 'error'
                        ? 'bg-rose-400'
                        : item.status === 'canceled'
                          ? 'bg-slate-300 dark:bg-slate-600'
                          : item.status === 'success'
                            ? 'bg-emerald-400'
                            : 'bg-indigo-500'
                    }`}
                    style={{ width: `${Math.round(item.progress * 100)}%` }}
                  />
                </div>

                {item.error ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-rose-500 dark:text-rose-400">
                    {item.error}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                    {formatBytes(item.size)}
                  </p>
                )}
              </div>

              {item.status === 'uploading' ? (
                <button
                  type="button"
                  onClick={() => cancelUpload(item.id)}
                  className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  aria-label={`取消上传 ${item.name}`}
                  title="取消上传"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
