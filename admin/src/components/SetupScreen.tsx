import { useState, type FormEvent } from 'react';
import { api, call, errorMessage } from '../api/ipc.ts';
import { CloudIcon, Spinner } from './Icons.tsx';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-950';

export function SetupScreen({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (password.length < 8) {
      setError('密码至少 8 位，且需要包含字母与数字');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await call(api.auth.setup({ username: username.trim(), password }));
      await onSuccess();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950 p-6">
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-950/60">
            <CloudIcon className="h-7 w-7" />
          </div>
          <p className="mt-3 text-sm font-semibold tracking-tight text-slate-200">欢迎使用 CloudBox</p>
          <p className="text-[11px] text-slate-500">首次运行，请创建唯一的管理员账户</p>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="setup-username"
                className="block text-sm font-medium text-slate-300"
              >
                管理员用户名
              </label>
              <input
                id="setup-username"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label
                htmlFor="setup-password"
                className="block text-sm font-medium text-slate-300"
              >
                管理员密码
              </label>
              <input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={INPUT_CLASS}
                placeholder="至少 8 位，含字母和数字"
              />
            </div>

            <div>
              <label
                htmlFor="setup-confirm"
                className="block text-sm font-medium text-slate-300"
              >
                确认密码
              </label>
              <input
                id="setup-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className={INPUT_CLASS}
                placeholder="再次输入密码"
              />
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
            {pending ? '正在创建…' : '创建管理员并进入'}
          </button>

          <p className="mt-4 text-center text-[11px] leading-5 text-slate-600">
            密码使用 scrypt 哈希保存，明文不会写入磁盘。创建后可在设置中重置。
          </p>
        </form>
      </div>
    </div>
  );
}
