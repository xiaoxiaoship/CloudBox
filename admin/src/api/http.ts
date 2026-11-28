import type {
  AdminStatus,
  AdminUser,
  CertificateInfo,
  CloudboxApi,
  PluginInfo,
  Result,
} from '../../../src/shared/ipcTypes.ts';
import type { AdminApi } from './types.ts';

class HttpAdminError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HttpAdminError';
    this.code = code;
  }
}

function readCookie(name: string): string {
  for (const part of document.cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('admin_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const record = (body ?? {}) as { code?: unknown; message?: unknown };
    throw new HttpAdminError(
      typeof record.code === 'string' ? record.code : `HTTP_${response.status}`,
      typeof record.message === 'string' ? record.message : `请求失败（HTTP ${response.status}）`,
    );
  }
  return body as T;
}

function resultOf<T>(operation: () => Promise<T>): Promise<Result<T>> {
  return operation().then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({
      ok: false as const,
      code: error instanceof HttpAdminError ? error.code : 'ADMIN_REQUEST_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

function notImplemented<T>(name: string): Promise<Result<T>> {
  return Promise.resolve({
    ok: false,
    code: 'ADMIN_NOT_IMPLEMENTED',
    message: `管理端接口尚未接入：${name}`,
  });
}

function namespace(name: string): Record<string, (...args: never[]) => Promise<Result<never>>> {
  return new Proxy({} as Record<string, (...args: never[]) => Promise<Result<never>>>, {
    get: (_target, property) => () => notImplemented(`${name}.${String(property)}`),
  });
}

function withOverrides<T extends object>(base: Record<string, unknown>, overrides: T): T {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return (target as Record<PropertyKey, unknown>)[property];
      const fallback = base[String(property)];
      return typeof fallback === 'function' ? fallback : () => notImplemented(`system.${String(property)}`);
    },
  });
}

interface AppInfo {
  version: string;
  dataDir: string;
  storageDir: string;
  pluginsDir: string;
}

export function createHttpAdminApi(): AdminApi {
  const auth: AdminApi['auth'] = {
    status: () => resultOf(async (): Promise<AdminStatus> => {
      const health = await request<{ version: string }>('/api/admin/health');
      const status = await request<{ needsSetup: boolean; authenticated: boolean; user: AdminUser | null }>('/api/admin/auth/status');
      const info = status.authenticated
        ? await request<AppInfo>('/api/admin/app/info').catch(() => null)
        : null;
      return {
        needsSetup: status.needsSetup,
        authenticated: status.authenticated,
        user: status.user,
        version: health.version,
        dataDir: info?.dataDir ?? '',
        storageDir: info?.storageDir ?? '',
        pluginsDir: info?.pluginsDir ?? '',
      };
    }),

    setup: (input) => resultOf(async () => {
      const payload = await request<{ user: AdminUser }>('/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ username: input.username, password: input.password, token: input.token }),
      });
      return payload.user;
    }),
    login: (input) => resultOf(async () => {
      const payload = await request<{ user: AdminUser }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return payload.user;
    }),
    logout: () => resultOf(async () => {
      await request('/api/admin/auth/logout', { method: 'POST' });
      return null;
    }),
    changePassword: (input) => resultOf(() => request('/api/admin/auth/password', { method: 'POST', body: JSON.stringify(input) })),
    sessions: () => resultOf(() => request('/api/admin/auth/sessions')),
    revokeAllSessions: () => resultOf(() => request('/api/admin/auth/sessions', { method: 'DELETE' })),
  };

  const app: AdminApi['app'] = {
    info: () => resultOf(async () => {
      const info = await request<AppInfo>('/api/admin/app/info');
      return { ...info, isPackaged: true, isPortable: false };
    }),
    openDataDir: () => notImplemented('app.openDataDir'),
    openStorageDir: () => notImplemented('app.openStorageDir'),
    openPluginsDir: () => notImplemented('app.openPluginsDir'),
    backupDatabase: () => resultOf(async () => {
      const response = await fetch('/api/admin/app/backup', { credentials: 'same-origin' });
      if (!response.ok) throw new HttpAdminError('DATABASE_BACKUP_FAILED', `备份失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const fileName = match?.[1] ?? 'cloudbox-backup.db';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      return { saved: true, fileName };
    }),
    chooseDirectory: () => Promise.resolve({ ok: true, data: { selected: false } }),
    changeDirectory: (input) => resultOf(() => request('/api/admin/app/directory', { method: 'POST', body: JSON.stringify(input) })),
    getStartup: () => Promise.resolve({ ok: true, data: { autoStart: false, startInTray: false } }),
    setStartup: () => Promise.resolve({ ok: true, data: { autoStart: false, startInTray: false } }),
  };

  const system: AdminApi['system'] = {
    checkUpdate: () => resultOf(() => request('/api/admin/system/check-update')),
    updateStatus: () => resultOf(() => request('/api/admin/system/update/status')),
    downloadUpdate: () => resultOf(() => request('/api/admin/system/update/download', { method: 'POST' })),
    installUpdate: () => resultOf(() => request('/api/admin/system/update/install', { method: 'POST' })),
    openExternal: (input) => resultOf(async () => {
      window.open(input.url, '_blank', 'noopener,noreferrer');
      return null;
    }),
    rateLimits: () => resultOf(() => request('/api/admin/system/rate-limits')),
    clearRateLimit: (input) => resultOf(async () => {
      await request('/api/admin/system/rate-limits/clear', { method: 'POST', body: JSON.stringify(input) });
      return null;
    }),
    securityBans: () => resultOf(() => request('/api/admin/system/security-bans')),
    clearSecurityBan: (input) => resultOf(async () => {
      await request(`/api/admin/system/security-bans/${input.id}/clear`, { method: 'POST' });
      return null;
    }),
    taskUsage: () => resultOf(() => request('/api/admin/system/task-usage')),
    clearAllSecurityBans: () => resultOf(() => request('/api/admin/system/security-bans/clear-all', { method: 'POST' })),
    securityCounts: () => resultOf(() => request('/api/admin/system/security-counts')),
    clearSecurityCount: (input) => resultOf(async () => {
      await request('/api/admin/system/security-counts/clear', { method: 'POST', body: JSON.stringify(input) });
      return null;
    }),
    clearAllSecurityCounts: () => resultOf(async () => {
      await request('/api/admin/system/security-counts/clear-all', { method: 'POST' });
      return null;
    }),
  };

  return {
    auth,
    users: {
      list: () => resultOf(() => request('/api/admin/users')),
      create: (input) => resultOf(() => request('/api/admin/users', { method: 'POST', body: JSON.stringify(input) })),
      setQuota: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}/quota`, { method: 'PATCH', body: JSON.stringify({ quotaBytes: input.quotaBytes }) });
        return null;
      }),
      resetPassword: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: input.newPassword }) });
        return null;
      }),
      unlock: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}/unlock`, { method: 'POST' });
        return null;
      }),
      setStatus: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}/status`, { method: 'PATCH', body: JSON.stringify({ status: input.status }) });
        return null;
      }),
      setSecurityMode: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}/security-mode`, { method: 'PATCH', body: JSON.stringify({ enabled: input.enabled }) });
        return null;
      }),
      clearRenameLimit: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}/clear-rename`, { method: 'POST' });
        return null;
      }),
      ipHistory: (input) => resultOf(() => request(`/api/admin/users/${input.userId}/ip-history`)),
      remove: (input) => resultOf(async () => {
        await request(`/api/admin/users/${input.userId}`, { method: 'DELETE', body: JSON.stringify({ deleteFiles: input.deleteFiles }) });
        return null;
      }),
      renameSelf: (input) => resultOf(() => request('/api/admin/users/me', { method: 'PATCH', body: JSON.stringify(input) })),
    },
    server: {
      status: () => resultOf(() => request('/api/admin/server/status')),
      setOnline: (input) => resultOf(() => request('/api/admin/server/online', { method: 'POST', body: JSON.stringify(input) })),
      setAutoStart: (input) => resultOf(() => request('/api/admin/server/auto-start', { method: 'POST', body: JSON.stringify(input) })),
      getSchedule: () => resultOf(() => request('/api/admin/server/schedule')),
      setSchedule: (input) => resultOf(() => request('/api/admin/server/schedule', { method: 'POST', body: JSON.stringify(input) })),
      setPort: (input) => resultOf(() => request('/api/admin/server/port', { method: 'POST', body: JSON.stringify(input) })),
      applyNetwork: (input) => resultOf(() => request('/api/admin/server/network', { method: 'POST', body: JSON.stringify(input) })),
      certificate: () => resultOf(() => request('/api/admin/ca/certificate')),
      importCertificate: (input) => resultOf(async () => {
        if (!input.content || !input.fileName) throw new HttpAdminError('ADMIN_FILE_REQUIRED', '请选择证书或私钥文件');
        const certificate = await request<CertificateInfo>('/api/admin/ca/import', {
          method: 'POST',
          body: JSON.stringify({ kind: input.kind, fileName: input.fileName, content: input.content }),
        });
        return { imported: true, certificate };
      }),
    },
    ca: {
      info: () => resultOf(() => request('/api/admin/ca/info')),
      create: () => resultOf(() => request('/api/admin/ca/create', { method: 'POST' })),
      install: () => resultOf(() => request('/api/admin/ca/install', { method: 'POST' })),
      uninstall: () => resultOf(() => request('/api/admin/ca/uninstall', { method: 'POST' })),
      issueServerCert: (input) => resultOf(() => request('/api/admin/ca/issue-server-cert', { method: 'POST', body: JSON.stringify(input) })),
      exportClientCert: () => resultOf(async () => {
        const response = await fetch('/api/admin/ca/client-cert', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': readCookie('admin_csrf') } });
        if (!response.ok) throw new HttpAdminError('CA_EXPORT_FAILED', `导出失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'cloudbox-client.p12'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
        return { saved: true, fileName: 'cloudbox-client.p12', password: 'changeit' };
      }),
    },
    settings: {
      get: () => resultOf(() => request('/api/admin/settings')),
      setPublicRegistration: (input) => resultOf(() => request('/api/admin/settings/public-registration', { method: 'POST', body: JSON.stringify(input) })),
      setTrustProxy: (input) => resultOf(() => request('/api/admin/settings/trust-proxy', { method: 'POST', body: JSON.stringify(input) })),
      setAdminWeb: (input) => resultOf(() => request('/api/admin/settings/admin-web', { method: 'POST', body: JSON.stringify(input) })),
      setSecurity: (input) => resultOf(() => request('/api/admin/settings/security', { method: 'POST', body: JSON.stringify(input) })),
      setResources: (input) => resultOf(() => request('/api/admin/settings/resources', { method: 'POST', body: JSON.stringify(input) })),
      setCacheCleanup: (input) => resultOf(() => request('/api/admin/settings/cache-cleanup', { method: 'POST', body: JSON.stringify(input) })),
      setDefaultQuota: (input) => resultOf(() => request('/api/admin/settings/default-quota', { method: 'POST', body: JSON.stringify(input) })),
      setAddressMode: (input) => resultOf(() => request('/api/admin/settings/address-mode', { method: 'POST', body: JSON.stringify(input) })),
      resetDefaults: () => resultOf(() => request('/api/admin/settings/reset-defaults', { method: 'POST' })),
      clearResourceCache: () => resultOf(() => request('/api/admin/settings/clear-cache', { method: 'POST' })),
      setPermissions: (input) => resultOf(() => request('/api/admin/settings/permissions', { method: 'POST', body: JSON.stringify(input) })),
      setScan: (input) => resultOf(() => request('/api/admin/settings/scan', { method: 'POST', body: JSON.stringify(input) })),
      setAi: (input) => resultOf(() => request('/api/admin/settings/ai', { method: 'POST', body: JSON.stringify(input) })),
      setHosting: (input) => resultOf(() => request('/api/admin/settings/hosting', { method: 'POST', body: JSON.stringify(input) })),
      setMail: (input) => resultOf(() => request('/api/admin/settings/mail', { method: 'POST', body: JSON.stringify(input) })),
      testMail: () => resultOf(() => request('/api/admin/settings/mail/test', { method: 'POST' })),
    },
    logs: {
      get: (input) => resultOf(() => request(`/api/admin/system/logs?limit=${input?.limit ?? 200}`)),
      export: () => resultOf(async () => {
        const response = await fetch('/api/admin/system/logs/export', { credentials: 'same-origin' });
        if (!response.ok) throw new HttpAdminError('LOG_EXPORT_FAILED', `导出失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'cloudbox-logs.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
        return { saved: true, fileName: 'cloudbox-logs.json' };
      }),
      clear: () => resultOf(() => request('/api/admin/system/logs/clear', { method: 'POST' })),
    },
    announcements: {
      list: () => resultOf(() => request('/api/admin/announcements')),
      create: (input) => resultOf(() => request('/api/admin/announcements', { method: 'POST', body: JSON.stringify(input) })),
      delete: (id) => resultOf(async () => { await request(`/api/admin/announcements/${id}`, { method: 'DELETE' }); return null; }),
    },
    system,
    frp: {
      status: () => resultOf(() => request('/api/admin/frp/status')),
      saveConfig: (input) => resultOf(() => request('/api/admin/frp/config', { method: 'POST', body: JSON.stringify(input) })),
      start: () => resultOf(() => request('/api/admin/frp/start', { method: 'POST' })),
      stop: () => resultOf(() => request('/api/admin/frp/stop', { method: 'POST' })),
      restart: () => resultOf(() => request('/api/admin/frp/restart', { method: 'POST' })),
      getSync: () => resultOf(() => request('/api/admin/frp/sync')),
      setSync: (input) => resultOf(() => request('/api/admin/frp/sync', { method: 'POST', body: JSON.stringify(input) })),
    },
    files: {
      list: (input) => resultOf(() => request(`/api/admin/files/list?userId=${input.userId}&path=${encodeURIComponent(input.path)}`)),
      download: (input) => resultOf(async () => {
        const response = await fetch(`/api/admin/files/download?userId=${input.userId}&path=${encodeURIComponent(input.path)}`, { credentials: 'same-origin' });
        if (!response.ok) throw new HttpAdminError('ADMIN_DOWNLOAD_FAILED', `下载失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') ?? '';
        const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
        const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
        const fileName = encoded ? decodeURIComponent(encoded) : plain ?? 'download';
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
        return { saved: true, fileName };
      }),
    },
    app,
    plugins: {
      list: () => resultOf(() => request('/api/admin/plugins')),
      import: (input) => resultOf(async () => {
        if (!input?.content || !input.fileName) throw new HttpAdminError('ADMIN_FILE_REQUIRED', '请选择插件 ZIP');
        const binary = atob(input.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const response = await fetch('/api/admin/plugins/import', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/zip', 'x-plugin-filename': input.fileName, 'x-csrf-token': readCookie('admin_csrf') },
          body: new Blob([bytes], { type: 'application/zip' }),
        });
        const text = await response.text();
        if (!response.ok) {
          let message = `插件导入失败（HTTP ${response.status}）`;
          try { const parsed = JSON.parse(text) as { message?: string }; if (parsed.message) message = parsed.message; } catch { /* ignore */ }
          throw new HttpAdminError('PLUGIN_IMPORT_FAILED', message);
        }
        return JSON.parse(text) as PluginInfo[];
      }),
      setEnabled: (input) => resultOf(() => request(`/api/admin/plugins/${input.name}/enabled`, { method: 'POST', body: JSON.stringify({ enabled: input.enabled }) })),
      setAllowWebOverride: (input) => resultOf(() => request(`/api/admin/plugins/${input.name}/web-override`, { method: 'POST', body: JSON.stringify({ allowed: input.allowed }) })),
      remove: (input) => resultOf(() => request(`/api/admin/plugins/${input.name}`, { method: 'DELETE' })),
      openAdmin: (input) => resultOf(async () => {
        window.open(`/api/admin/plugins/${input.name}/admin/index.html`, '_blank', 'noopener,noreferrer');
        return null;
      }),
    },
  };
}
