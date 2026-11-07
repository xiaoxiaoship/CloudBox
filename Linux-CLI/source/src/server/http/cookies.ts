import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'cloudbox_session';
export const CSRF_COOKIE = 'cloudbox_csrf';
export const CSRF_HEADER = 'x-csrf-token';

interface CookieCarrier {
  headers: {
    cookie?: string | undefined;
  };
}

/** 极简 Cookie 读取（避免为单个 header 引入 cookie-parser） */
export function readCookie(req: CookieCarrier, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    if (key !== name) continue;

    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 恒定时间比较，避免通过响应时间猜测 CSRF token */
export function csrfTokensMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
