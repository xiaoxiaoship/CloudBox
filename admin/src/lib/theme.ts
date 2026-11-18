export type AdminTheme = 'dark' | 'light';

const KEY = 'cloudbox.admin.theme';

export function readAdminTheme(): AdminTheme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function applyAdminTheme(theme: AdminTheme): void {
  document.documentElement.classList.toggle('theme-light', theme === 'light');
  document.documentElement.dataset.theme = theme;
}

export function saveAdminTheme(theme: AdminTheme): void {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  applyAdminTheme(theme);
}
