import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { DialogShell } from './Dialog.tsx';
import { Spinner } from './Icons.tsx';

interface RegisterDialogProps {
  onClose: () => void;
  onSuccess: (username: string) => void;
}

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-950/60';

export function RegisterDialog({ onClose, onSuccess }: RegisterDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = username.trim();

    if (!/^[A-Za-z0-9]{3,20}$/.test(name)) {
      setError('用户名必须为 3-20 位字母或数字');
      return;
    }
    if (password.length < 8) {
      setError('密码至少需要 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.register(name, password);
      onSuccess(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '注册失败，请稍后重试');
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogShell
      title="注册账号"
      description="注册成功后即可登录并上传文件"
      onClose={pending ? () => {} : onClose}
      footer={
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
            type="submit"
            form="cloudbox-register-form"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {pending ? <Spinner className="h-4 w-4" /> : null}
            注册
          </button>
        </>
      }
    >
      <form id="cloudbox-register-form" onSubmit={(event) => void submit(event)}>
        <div className="space-y-3">
          <div>
            <label
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              htmlFor="register-username"
            >
              用户名
            </label>
            <input
              ref={usernameRef}
              id="register-username"
              autoComplete="username"
              value={username}
              maxLength={20}
              onChange={(event) => setUsername(event.target.value)}
              className={INPUT_CLASS}
              placeholder="3-20 位字母或数字"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              htmlFor="register-password"
            >
              密码
            </label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              className={INPUT_CLASS}
              placeholder="至少 8 位"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              htmlFor="register-confirm"
            >
              确认密码
            </label>
            <input
              id="register-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              maxLength={128}
              onChange={(event) => setConfirm(event.target.value)}
              className={INPUT_CLASS}
              placeholder="再次输入密码"
            />
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </form>
    </DialogShell>
  );
}
