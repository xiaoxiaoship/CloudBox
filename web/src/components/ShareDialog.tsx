import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type FileEntry, type ShareCreated } from '../api/client.ts';
import { DialogShell } from './Dialog.tsx';
import { ShareIcon, Spinner } from './Icons.tsx';

const DURATION_OPTIONS = [30, 60, 300, 1_800, 3_600, 7_200] as const;

function durationLabel(seconds: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  return t(`share.duration.${seconds}`, { defaultValue: `${seconds}s` });
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
  const { t, i18n } = useTranslation();
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
      setError(cause instanceof Error ? cause.message : t('share.createFailed'));
    } finally {
      setPending(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!share) return;
    try {
      await copyText(share.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError(t('share.copyFailed'));
    }
  };

  const warning = t('share.warning', { duration: durationLabel(duration, t) });

  return (
    <DialogShell
      title={t('share.title')}
      description={t('share.file', { name: entry.name })}
      onClose={pending ? () => {} : onClose}
      footer={
        share ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShare(null);
                setCopied(false);
              }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              {t('share.regenerate')}
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
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {pending ? <Spinner className="h-4 w-4" /> : <ShareIcon className="h-4 w-4" />}
              {t('share.generate')}
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
            {t('share.validity')}
          </label>
          <select
            id="share-duration"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            disabled={pending || share !== null}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-950/60"
          >
            {DURATION_OPTIONS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {durationLabel(seconds, t)}
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
              {t('share.link')}
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="share-url"
                readOnly
                value={share.url}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
              >
                {copied ? t('share.copied') : t('share.copy')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
              {t('share.expiresAt', { time: new Date(share.expires_at).toLocaleString(i18n.language) })}
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
