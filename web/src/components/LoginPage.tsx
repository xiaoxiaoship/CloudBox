import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';
import { CloudIcon, EyeIcon, EyeOffIcon, Spinner } from './Icons.tsx';
import { RegisterDialog } from './RegisterDialog.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { useTranslation } from 'react-i18next';

export function LoginPage() {
  const { t } = useTranslation();
  const login = useAppStore((state) => state.login);
  const storeError = useAppStore((state) => state.error);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caAvailable, setCaAvailable] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .publicSettings()
      .then((settings) => {
        if (active) setAllowRegistration(settings.allow_public_registration);
      })
      .catch(() => {
        if (active) setAllowRegistration(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/public/root-ca.crt', { method: 'HEAD', cache: 'no-store' })
      .then((response) => {
        if (active) setCaAvailable(response.ok);
      })
      .catch(() => {
        if (active) setCaAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!username.trim() || !password) {
      setError(t('auth.enterCredentials'));
      return;
    }

    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await login(username.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('auth.loginFailed'));
    } finally {
      setPending(false);
    }
  };

  const handleRegistered = (registeredUsername: string): void => {
    setShowRegister(false);
    setUsername(registeredUsername);
    setPassword('');
    setError(null);
    setNotice(t('auth.registerSuccess'));
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-sky-100 px-4 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950">
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl dark:bg-indigo-500/10" />
      <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-sky-200/50 blur-3xl dark:bg-sky-500/10" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-200 dark:shadow-indigo-950/50">
            <CloudIcon className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            CloudBox
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('auth.subtitle')}</p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-200/60 backdrop-blur transition-colors sm:p-8 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/40"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                {t('auth.username')}
              </label>
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-950/60"
                placeholder={t('auth.enterUsername')}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                {t('auth.password')}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-950/60"
                  placeholder={t('auth.enterPassword')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-4.5 w-4.5" />
                  ) : (
                    <EyeIcon className="h-4.5 w-4.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {notice ? (
            <p className="mt-4 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {notice}
            </p>
          ) : null}

          {error || storeError ? (
            <p className="mt-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              {error ?? storeError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-indigo-950/50"
          >
            {pending ? <Spinner className="h-4 w-4" /> : null}
            {pending ? t('auth.loggingIn') : t('auth.login')}
          </button>

          <p className="mt-5 text-center text-xs leading-5 text-slate-400 dark:text-slate-500">
            {allowRegistration
              ? '也可以使用管理员提供的账号登录。'
              : '账号由管理员在桌面端创建。若忘记密码，请联系管理员重置。'}
          </p>

          {allowRegistration ? (
            <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
              {t('auth.noAccount')}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setShowRegister(true);
                }}
                className="ml-0.5 font-medium text-indigo-600 underline-offset-2 transition hover:text-indigo-500 hover:underline dark:text-indigo-300 dark:hover:text-indigo-200"
              >
                {t('auth.clickRegister')}
              </button>
            </p>
          ) : null}

          {caAvailable ? (
            <p className="mt-3 text-center text-[11px]">
              <a
                href="/api/public/root-ca.crt"
                download
                className="text-indigo-500 underline-offset-2 transition hover:text-indigo-600 hover:underline dark:text-indigo-300 dark:hover:text-indigo-200"
              >
                {t('auth.certHint')}
              </a>
            </p>
          ) : null}
        </form>

        <p className="mt-6 text-center text-[11px] text-slate-400 dark:text-slate-500">
          {t('auth.webFooter')}
        </p>
      </div>

      {showRegister ? (
        <RegisterDialog
          onClose={() => setShowRegister(false)}
          onSuccess={handleRegistered}
        />
      ) : null}
    </div>
  );
}
