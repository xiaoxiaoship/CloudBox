import { useState } from 'react';
import { api, type FileEntry, type ShareCreated } from '../api/client.ts';
import { DialogShell } from './Dialog.tsx';
import { ShareIcon, Spinner } from './Icons.tsx';

const DURATION_OPTIONS = [
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 1_800, label: '30 分钟' },
  { value: 3_600, label: '1 小时' },
  { value: 7_200, label: '2 小时' },
] as const;

function durationLabel(seconds: number): string {
  const option = DURATION_OPTIONS.find((item) => item.value === seconds);
  return option?.label ?? `${seconds} 秒`;
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 退回到 execCommand，兼容非安全上下文/权限被拒
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function ShareDialog({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const [duration, setDuration] = useState(300);
  const [share, setShare] = useState<ShareCreated | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async (): Promise<void> => {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const created = await api.createShare(entry.path, duration);
      setShare(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成分享链接失败');
    } finally {
      setPending(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!share) return;
    try {
      await copyText(absoluteUrl(share.url));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError('复制失败，请手动选中链接复制');
    }
  };

  const warning = `任何人获得此链接均可下载该文件，请勿分享给不信任的人。链接将在 ${durationLabel(
    duration,
  )}后自动失效。`;

  return (
    <DialogShell
      title="分享直链"
      description={`文件：${entry.name}`}
      onClose={pending ? () => {} : onClose}
      footer={
        share ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => {
                setShare(null);
                setCopied(false);
              }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              重新生成
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {pending ? <Spinner className="h-4 w-4" /> : <ShareIcon className="h-4 w-4" />}
              生成直链
            </button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="share-duration"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            链接有效期
          </label>
          <select
            id="share-duration"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            disabled={pending || share !== null}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-950/60"
          >
            {DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {share ? (
          <div>
            <label
              htmlFor="share-url"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              分享链接
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="share-url"
                readOnly
                value={absoluteUrl(share.url)}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
              >
                {copied ? '已复制' : '一键复制'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              有效期至 {new Date(share.expires_at).toLocaleString('zh-CN')}
            </p>
          </div>
        ) : null}

        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {warning}
        </p>

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </DialogShell>
  );
}
