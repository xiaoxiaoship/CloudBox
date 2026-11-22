import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateCheckResult, UpdateStatus } from '../../../src/shared/ipcTypes.ts';
import { call, errorMessage } from '../api/ipc.ts';
import { useAdminApi } from '../api/AdminApiContext.tsx';
import { Modal } from './Dialog.tsx';
import { Spinner } from './Icons.tsx';

interface UpdateDialogProps {
  currentVersion: string;
  onClose: () => void;
  onFoundUpdate?: () => void;
}

interface AppEnvironment {
  isPackaged: boolean;
  isPortable: boolean;
}

const REPO_URL = 'https://github.com/xiaoxiaoship/CloudBox';

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function UpdateDialog({ currentVersion, onClose, onFoundUpdate }: UpdateDialogProps) {
  const api = useAdminApi();
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<AppEnvironment | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const autoInstallRef = useRef(false);

  useEffect(() => {
    let active = true;
    void call(api.app.info())
      .then((info) => {
        if (active) setEnvironment({ isPackaged: info.isPackaged, isPortable: info.isPortable });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const active = status?.phase === 'downloading' || status?.phase === 'downloaded'
      || status?.phase === 'installing' || status?.phase === 'restarting';
    if (!active || !api.system.updateStatus) return;
    const refresh = async (): Promise<void> => {
      try { setStatus(await call(api.system.updateStatus!())); } catch { /* keep polling */ }
    };
    pollRef.current = window.setInterval(() => { void refresh(); }, 500);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [status?.phase, api.system.updateStatus]);

  const check = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    try {
      const next = await call(api.system.checkUpdate());
      setResult(next);
      if (next.hasUpdate) onFoundUpdate?.();
      if (api.system.updateStatus) setStatus(await call(api.system.updateStatus()));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setChecking(false);
    }
  };

  const openUrl = async (url: string): Promise<void> => {
    try {
      await call(api.system.openExternal({ url }));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const startDownload = async (): Promise<void> => {
    setError(null);
    autoInstallRef.current = true;
    if (!api.system.downloadUpdate) {
      if (result?.downloadUrl) await openUrl(result.downloadUrl);
      return;
    }
    setStarting(true);
    setStatus({
      phase: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: result?.assetSize ?? null,
      currentVersion, latestVersion: result?.latestVersion ?? null, assetName: result?.assetName ?? null,
      error: null, checkedAt: Date.now(),
    });
    void call(api.system.downloadUpdate())
      .then((next) => setStatus(next))
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setStarting(false));
  };

  const startInstall = async (): Promise<void> => {
    setError(null);
    if (!api.system.installUpdate) return;
    setStarting(true);
    try {
      setStatus(await call(api.system.installUpdate()));
    } catch (cause) {
      setError(errorMessage(cause));
      setStarting(false);
    }
  };

  useEffect(() => {
    if (status?.phase === 'downloaded' && autoInstallRef.current) {
      autoInstallRef.current = false;
      void startInstall();
    }
  }, [status?.phase]);

  const installHint = environment?.isPortable
    ? t('admin.update.portableHint')
    : environment !== null && !environment.isPackaged
      ? t('admin.update.devHint')
      : t('admin.update.installedHint');

  const progress = status?.phase === 'downloaded' ? 100 : status?.progress ?? 0;
  const downloadLabel = status?.phase === 'downloading'
    ? t('admin.update.downloading', { progress })
    : t('admin.update.downloadNow');

  return (
    <Modal
      title={t('admin.update.title')}
      description={t('admin.update.current', { version: currentVersion })}
      onClose={status?.phase === 'installing' ? () => {} : onClose}
      width="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={status?.phase === 'installing'} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            {t('admin.update.close')}
          </button>
          <button type="button" onClick={() => void check()} disabled={checking || status?.phase === 'downloading' || status?.phase === 'installing'} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
            {checking ? <Spinner className="h-3.5 w-3.5" /> : null}
            {t('admin.update.check')}
          </button>
          {result?.hasUpdate ? (
            status?.phase === 'downloaded' ? (
              <button type="button" onClick={() => void startInstall()} disabled={starting} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
                {starting ? <Spinner className="h-3.5 w-3.5" /> : null}
                {t('admin.update.installNow')}
              </button>
            ) : (
              <button type="button" onClick={() => void startDownload()} disabled={starting || status?.phase === 'downloading'} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
                {status?.phase === 'downloading' ? <Spinner className="h-3.5 w-3.5" /> : null}
                {status?.phase === 'downloading' ? downloadLabel : t('admin.update.downloadAndInstall')}
              </button>
            )
          ) : null}
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-300">
        {error ? <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">{error}</p> : null}
        {status?.phase === 'error' && status.error ? <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">{status.error}</p> : null}

        {result === null ? (
          <p className="text-xs leading-6 text-slate-500">{t('admin.update.intro')}</p>
        ) : result.hasUpdate ? (
          <>
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
              <p className="font-medium text-amber-200">{t('admin.update.found', { version: result.latestVersion })}</p>
              <p className="mt-1 text-xs leading-5 text-amber-300">{t('admin.update.keepData')}</p>
            </div>
            {status && status.phase !== 'idle' && status.phase !== 'available' ? (
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-slate-200">{t(`admin.update.phase.${status.phase}`)}</span>
                  {status.phase === 'downloading' ? <span className="font-mono text-slate-400">{progress}%</span> : null}
                  {status.phase === 'installing' || status.phase === 'restarting' ? <Spinner className="h-4 w-4 text-emerald-300" /> : null}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {status.phase === 'downloading'
                    ? t('admin.update.progressDetail', { done: formatBytes(status.downloadedBytes), total: status.totalBytes ? formatBytes(status.totalBytes) : '?' })
                    : t(`admin.update.phaseHint.${status.phase}`)}
                </p>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-medium text-slate-200">{t('admin.update.notes')}</p>
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-400">
                {result.releaseNotes || t('admin.update.noNotes')}
              </pre>
            </div>
            <p className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] leading-5 text-slate-400">{installHint}</p>
          </>
        ) : (
          <p className="rounded-xl border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
            {t('admin.update.latest', { version: result.latestVersion })}
          </p>
        )}

        <div className="border-t border-slate-800 pt-3 text-[11px] leading-6 text-slate-500">
          <p>{t('admin.update.devInfo')}</p>
          <p>
            {t('admin.update.repo')}
            <button type="button" onClick={() => void openUrl(REPO_URL)} className="text-sky-300 hover:underline">{REPO_URL}</button>
          </p>
          <p>{t('admin.update.contact')}</p>
          <p>{t('admin.update.group')}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-6 text-slate-500">
          <p className="font-medium text-slate-300">{t('admin.update.credits')}</p>
          <p>{t('admin.update.creditsList')}</p>
          <p className="mt-1">{t('admin.update.creditsThanks')}</p>
          <p className="mt-1">{t('admin.update.creditsDsh')}</p>
        </div>
      </div>
    </Modal>
  );
}
