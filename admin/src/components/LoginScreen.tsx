import { useState, type FormEvent, type ReactNode } from 'react';
import { api, call, errorMessage } from '../api/ipc.ts';
import { CloudIcon, EyeIcon, EyeOffIcon, Spinner } from './Icons.tsx';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-950';

const LABEL_CLASS = 'block text-sm font-medium text-slate-300';

export function LoginScreen({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('请输入管理员用户名和密码');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await call(api.auth.login({ username: username.trim(), password }));
      await onSuccess();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <form
        onSubmit={(event) => void submit(event)}
        className="rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl shadow-black/40 backdrop-blur"
      >
        <h1 className="text-lg font-semibold text-slate-100">管理员登录</h1>
        <p className="mt-1 text-sm text-slate-500">管理账户、配额与局域网服务</p>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="admin-username" className={LABEL_CLASS}>
              用户名
            </label>
            <input
              id="admin-username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={INPUT_CLASS}
              placeholder="管理员用户名"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className={LABEL_CLASS}>
              密码
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${INPUT_CLASS} pr-11`}
                placeholder="管理员密码"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-0 mt-1.5 flex w-10 items-center justify-center text-slate-500 transition hover:text-slate-300"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:opacity-60"
        >
          {pending ? <Spinner className="h-4 w-4" /> : null}
          {pending ? '登录中…' : '登录'}
        </button>
      </form>
    </AuthLayout>
  );
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950 p-6">
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-950/60">
            <CloudIcon className="h-7 w-7" />
          </div>
          <p className="mt-3 text-sm font-semibold tracking-tight text-slate-200">CloudBox</p>
          <p className="text-[11px] text-slate-500">本地多用户网盘 · 管理控制台</p>
        </div>

        {children}

        <p className="mt-5 text-center text-[11px] text-slate-600">
          管理密码使用 scrypt 哈希存储，会话仅保存在本机内存
        </p>
      </div>
    </div>
  );
}
