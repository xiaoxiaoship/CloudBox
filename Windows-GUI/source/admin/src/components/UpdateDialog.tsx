import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateCheckResult } from '../../../src/shared/ipcTypes.ts';
import { api, call, errorMessage } from '../api/ipc.ts';
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

export function UpdateDialog({ currentVersion, onClose, onFoundUpdate }: UpdateDialogProps) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<AppEnvironment | null>(null);
  const [opening, setOpening] = useState(false);

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

  const check = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    try {
      const next = await call(api.system.checkUpdate());
      setResult(next);
      if (next.hasUpdate) onFoundUpdate?.();
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

  const openDownload = async (): Promise<void> => {
    if (!result?.downloadUrl) return;
    setOpening(true);
    try {
      await call(api.system.openExternal({ url: result.downloadUrl }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOpening(false);
    }
  };

  const installHint = environment?.isPortable
    ? t('admin.update.portableHint')
    : environment !== null && !environment.isPackaged
      ? t('admin.update.devHint')
      : t('admin.update.installedHint');

  return (
    <Modal
      title={t('admin.update.title')}
      description={t('admin.update.current', { version: currentVersion })}
      onClose={onClose}
      width="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
            {t('admin.update.close')}
          </button>
          <button type="button" onClick={() => void check()} disabled={checking} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
            {checking ? <Spinner className="h-3.5 w-3.5" /> : null}
            {t('admin.update.check')}
          </button>
          {result?.hasUpdate ? (
            <button type="button" onClick={() => void openDownload()} disabled={opening} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
              {opening ? <Spinner className="h-3.5 w-3.5" /> : null}
              {t('admin.update.download')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-300">
        {error ? <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">{error}</p> : null}

        {result === null ? (
          <p className="text-xs leading-6 text-slate-500">
            {t('admin.update.intro')}
          </p>
        ) : result.hasUpdate ? (
          <>
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
              <p className="font-medium text-amber-200">{t('admin.update.found', { version: result.latestVersion })}</p>
              <p className="mt-1 text-xs leading-5 text-amber-300">
                {t('admin.update.keepData')}
              </p>
            </div>
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
            <button type="button" onClick={() => void openUrl(REPO_URL)} className="text-sky-300 hover:underline">
              {REPO_URL}
            </button>
          </p>
          <p>{t('admin.update.contact')}</p>
          <p>{t('admin.update.group')}</p>
        </div>
      </div>
    </Modal>
  );
}
