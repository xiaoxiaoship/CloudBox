export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cloudbox-theme';

export function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // 隐私模式/禁用 localStorage 时回退系统主题
  }
  return 'system';
}

export function writeStoredTheme(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 忽略写入失败，主题在当前会话仍然生效
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

/** 应用主题到 <html>，同时更新 color-scheme 与移动端 theme-color */
export function applyTheme(theme: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;

  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#020617' : '#f8fafc');
  }

  return resolved;
}
