import { useState } from 'react';
import { DialogShell } from './Dialog.tsx';

export function ExtractPasswordDialog({
  name,
  error,
  onSubmit,
  onClose,
}: {
  name: string;
  error: string | null;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <DialogShell
      title="压缩包已加密"
      description={`「${name}」需要密码才能解压。`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">取消</button>
          <button
            type="button"
            disabled={pending || password === ''}
            onClick={() => {
              setPending(true);
              void onSubmit(password).finally(() => setPending(false));
            }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >{pending ? '解压中…' : '开始解压'}</button>
        </>
      )}
    >
      <label className="block text-xs text-slate-500">压缩包密码
        <input
          autoFocus
          type="password"
          value={password}
          maxLength={128}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && password !== '' && !pending) {
              setPending(true);
              void onSubmit(password).finally(() => setPending(false));
            }
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
      </label>
      {error ? <p className="mt-2 text-xs text-rose-500">{error}</p> : null}
    </DialogShell>
  );
}
