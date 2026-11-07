import { useEffect, useState } from 'react';
import type { AdminStatus } from '../../src/shared/ipcTypes.ts';
import { api, bridgeAvailable, call, errorMessage } from './api/ipc.ts';
import { LoginScreen } from './components/LoginScreen.tsx';
import { SetupScreen } from './components/SetupScreen.tsx';
import { Shell } from './components/Shell.tsx';
import { Toast, type ToastState } from './components/Dialog.tsx';
import { AlertIcon, CloudIcon, Spinner } from './components/Icons.tsx';
import { installAdminTranslations } from './i18nDom.ts';

export type PageKey = 'dashboard' | 'users' | 'files' | 'network' | 'plugins' | 'settings';

export default function App() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [booting, setBooting] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [page, setPage] = useState<PageKey>('dashboard');
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = (kind: ToastState['kind'], message: string): void => {
    setToast({ kind, message });
  };

  const refreshStatus = async (): Promise<void> => {
    const next = await call(api.auth.status());
    setStatus(next);
  };

  useEffect(() => {
    if (!bridgeAvailable) {
      setFatal('未检测到 Electron 预加载桥接，请通过桌面程序启动 CloudBox。');
      setBooting(false);
      return;
    }

    const cleanup = installAdminTranslations();
    void (async () => {
      try {
        await refreshStatus();
      } catch (error) {
        setFatal(errorMessage(error));
      } finally {
        setBooting(false);
      }
    })();
    return cleanup;
  }, []);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (booting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-950">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <CloudIcon className="h-7 w-7" />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" />
          正在初始化管理控制台…
        </div>
      </div>
    );
  }

  if (fatal !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950 p-8 text-center">
        <AlertIcon className="h-9 w-9 text-rose-400" />
        <p className="text-sm font-medium text-slate-200">无法启动管理控制台</p>
        <p className="max-w-md text-xs leading-5 text-slate-500">{fatal}</p>
      </div>
    );
  }

  if (status === null) return null;

  if (status.needsSetup) {
    return <SetupScreen onSuccess={refreshStatus} />;
  }

  if (!status.authenticated || status.user === null) {
    return <LoginScreen onSuccess={refreshStatus} />;
  }

  return (
    <>
      <Shell
        status={status}
        user={status.user}
        page={page}
        onNavigate={setPage}
        onLogout={async () => {
          try {
            await call(api.auth.logout());
          } finally {
            await refreshStatus();
            setPage('dashboard');
          }
        }}
        notify={notify}
      />
      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
