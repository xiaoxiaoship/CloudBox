import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore.ts';
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme, type ThemePreference } from '../lib/theme.ts';
import { MonitorIcon, MoonIcon, SunIcon } from './Icons.tsx';

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof SunIcon;
}> = [
  { value: 'light', label: '浅色', icon: SunIcon },
  { value: 'dark', label: '深色', icon: MoonIcon },
  { value: 'system', label: '跟随系统', icon: MonitorIcon },
];

/**
 * 三态主题切换：浅色 / 深色 / 跟随系统。
 * 分段按钮比下拉菜单更直接，移动端也不会遮挡内容。
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  return (
    <div
      role="group"
      aria-label="主题模式"
      className={`inline-flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            className={`rounded-[10px] p-1.5 transition ${
              active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * 主题副作用组件：
 *  - 应用 store.theme 到 <html>
 *  - 跟随系统时监听 prefers-color-scheme 变化
 *  - 监听 storage 事件，让多个标签页保持同步
 */
export function ThemeSync() {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      applyTheme('system');
    };

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = readStoredTheme();
      if (next !== useAppStore.getState().theme) {
        useAppStore.getState().setTheme(next);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}
