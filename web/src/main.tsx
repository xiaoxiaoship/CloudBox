import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import GuestPage from './components/GuestPage.tsx';
import './styles.css';
import './i18n.ts';

// iOS 16 Safari/WebKit lacks Promise.withResolvers, which pdf.js 4.x uses.
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
  (Promise as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } }).withResolvers = function <T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// 访客页与主应用彻底分离：/guest/:token 下不加载登录 store（懒加载 App 单独分包）。
const App = lazy(() => import('./App.tsx'));

const guestMatch = /^\/guest\/([a-f0-9]+)\/?$/.exec(window.location.pathname);
const guestToken = guestMatch?.[1] ?? null;

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    {guestToken !== null ? (
      <GuestPage token={guestToken} />
    ) : (
      <Suspense
        fallback={
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950">
            <p className="text-sm text-slate-500 dark:text-slate-400">正在连接 CloudBox…</p>
          </div>
        }
      >
        <App />
      </Suspense>
    )}
  </StrictMode>,
);
