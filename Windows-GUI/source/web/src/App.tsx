import { useEffect } from 'react';
import { FilesPage } from './components/FilesPage.tsx';
import { AudioPlayer } from './components/AudioPlayer.tsx';
import { LoginPage } from './components/LoginPage.tsx';
import { ThemeSync } from './components/ThemeToggle.tsx';
import { useAppStore } from './store/useAppStore.ts';

export default function App() {
  const initialized = useAppStore((state) => state.initialized);
  const user = useAppStore((state) => state.user);
  const init = useAppStore((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <>
      <ThemeSync />
      {!initialized ? (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-950/50">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
              <path d="M6.5 19a4.5 4.5 0 0 1-.53-8.97A6.5 6.5 0 0 1 18.4 9.1 4 4 0 0 1 18 17H6.5Z" />
            </svg>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">正在连接 CloudBox…</p>
        </div>
      ) : user ? (
        <>
          <FilesPage />
          <AudioPlayer />
        </>
      ) : (
        <LoginPage />
      )}
    </>
  );
}
