import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type FileEntry } from '../api/client.ts';
import { DialogShell } from './Dialog.tsx';

export function CompressDialog({
  entries,
  currentPath,
  onClose,
  onStarted,
}: {
  entries: FileEntry[];
  currentPath: string;
  onClose: () => void;
  onStarted: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('archive.zip');
  const [level, setLevel] = useState(6);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      if (encrypt && password.length === 0) throw new Error(t('compress.passwordRequired'));
      if (encrypt && password !== confirm) throw new Error(t('compress.passwordMismatch'));
      const { taskId } = await api.compress(entries.map((entry) => entry.path), currentPath, name, level, encrypt ? password : undefined);
      onStarted(taskId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('compress.failed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogShell
      title={t('compress.title')}
      description={t('compress.description', { count: entries.length })}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">{t('common.cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? t('compress.running') : t('compress.start')}</button>
        </>
      )}
    >
      <div className="space-y-3">
        <label className="block text-xs text-slate-500">{t('compress.name')}
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        </label>
        <label className="block text-xs text-slate-500">{t('compress.level')}
          <select value={level} onChange={(event) => setLevel(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
            {[1, 3, 5, 6, 7, 9].map((value) => <option key={value} value={value}>{t('compress.levelOption', { level: value })}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={encrypt} onChange={(event) => setEncrypt(event.target.checked)} className="accent-indigo-500" />
          {t('compress.encrypt')}
        </label>
        {encrypt ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-500">{t('compress.password')}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block text-xs text-slate-500">{t('compress.confirmPassword')}
              <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} maxLength={128} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
            </label>
          </div>
        ) : null}
        {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      </div>
    </DialogShell>
  );
}
