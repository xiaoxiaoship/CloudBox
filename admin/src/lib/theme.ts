export type AdminTheme = 'dark' | 'light' | 'system';

const KEY = 'cloudbox.admin.theme';

export function readAdminTheme(): AdminTheme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'system' ? value : 'dark';
  } catch { return 'dark'; }
}

interface NativeThemeBridge {
  current: () => 'light' | 'dark';
  subscribe: (callback: (theme: 'light' | 'dark') => void) => () => void;
}

function nativeThemeBridge(): NativeThemeBridge | undefined {
  return (window as unknown as { cloudboxTheme?: NativeThemeBridge }).cloudboxTheme;
}

function resolvedTheme(theme: AdminTheme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  const native = nativeThemeBridge()?.current();
  if (native !== undefined) return native;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function subscribeAdminSystemTheme(callback: () => void): () => void {
  const native = nativeThemeBridge();
  if (native !== undefined) return native.subscribe(() => callback());
  const media = window.matchMedia?.('(prefers-color-scheme: light)');
  if (media === undefined) return () => {};
  const onChange = (): void => callback();
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function applyAdminTheme(theme: AdminTheme): void {
  const resolved = resolvedTheme(theme);
  document.documentElement.classList.toggle('theme-light', resolved === 'light');
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = theme;
}

export function saveAdminTheme(theme: AdminTheme): void {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  applyAdminTheme(theme);
}
