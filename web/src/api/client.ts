export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  securityMode?: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  avatarDataUrl?: string | null;
  createdAt: number;
}

export interface UsageInfo {
  quotaBytes: number | null;
  usedBytes: number;
  availableBytes: number | null;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number | null;
  modifiedAt: number;
}

export interface FileListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
}

export interface PreviewInfo {
  kind: 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'office' | 'none';
  mime: string | null;
  size: number;
  name: string;
  path: string;
}

export interface ShareCreated {
  token: string;
  path: string;
  url: string;
  file_path: string;
  expires_at: number;
}

export interface PublicSettings {
  allow_public_registration: boolean;
  permissions: {
    allow_user_preview_image: boolean;
    allow_user_preview_video: boolean;
    allow_user_preview_pdf: boolean;
    allow_user_preview_office: boolean;
    allow_user_extract: boolean;
    allow_user_scan: boolean;
    allow_user_compress: boolean;
    allow_user_direct_share: boolean;
    allow_user_archive_preview: boolean;
    allow_guest_mode: boolean;
  };
  scan_enabled: boolean;
  upload_queue_concurrency: number;
  ai_enabled: boolean;
  ai_mode: 'admin' | 'user';
  hosting_enabled: boolean;
  hosting_mode: 'auto' | 'public';
  guest_address_mode: 'auto' | 'public';
  hosting_base_url: string;
}

export type AnnouncementCategory = 'critical' | 'warning' | 'info';
export interface AnnouncementView {
  id: number;
  category: AnnouncementCategory;
  body: string;
  createdAt: number;
  read: boolean;
}

export interface PluginSlot {
  id: string;
  title: string;
  icon: string;
  position: 'bottom-right' | 'bottom-left' | 'sidebar';
  plugin: string;
  iframeUrl: string;
  token: string;
}

export interface GuestLinkView {
  token: string;
  url: string;
  hasPassword: boolean;
  expiresAt: number;
}

export interface GuestStatus {
  enabled: boolean;
  link: GuestLinkView | null;
}

export interface GuestPublicInfo {
  ownerUsername: string;
  hasPassword: boolean;
  expiresAt: number;
}

export interface GuestUnlockResult {
  unlocked: boolean;
  expiresAt: number;
  ownerUsername: string;
}

export interface HostingSettings {
  enabled: boolean;
  rootPath: string;
  visibility: 'public' | 'private';
  url: string;
  hostingEnabled: boolean;
  baseUrl: string;
  mode: 'auto' | 'public';
}

export interface AiSettings {
  enabled: boolean;
  mode: 'admin' | 'user';
  hasApiKey: boolean;
  maskedApiKey: string;
  baseUrl: string;
  model: string;
  dailyLimit: number;
  workScope: 'folder' | 'all';
  workDir: string;
  usedToday: number;
}

export interface AiStreamEvent {
  type: 'content' | 'tool' | 'confirmation' | 'done' | 'error';
  text?: string;
  name?: string;
  result?: unknown;
  actionId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  message?: string;
  usage?: { used: number; limit: number };
}

export interface BackgroundTask {
  id: string;
  userId: number;
  type: 'extract' | 'scan' | 'compress' | 'upload';
  status:
    | 'pending'
    | 'queued'
    | 'paused'
    | 'cancelled'
    | 'running'
    | 'scanning'
    | 'clean'
    | 'infected'
    | 'skipped'
    | 'completed'
    | 'failed';
  result: unknown;
  error: string | null;
  queuePosition?: number | null;
  residualPaths?: string[];
}

export interface TextPreview {
  kind: 'text';
  text: string;
  encoding: string;
  truncated: boolean;
  size: number;
}

export interface LoginResponse {
  user: PublicUser;
  csrfToken: string;
  expiresAt: number;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: PublicUser;
  usage: UsageInfo;
  csrfToken: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = '';

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

let capSolvePromise: Promise<string> | null = null;

async function solveCap(): Promise<string> {
  if (capSolvePromise !== null) return capSolvePromise;
  capSolvePromise = (async () => {
    const { default: Cap } = await import('@cap.js/widget');
    const host = document.createElement('cap-widget') as unknown as import('@cap.js/widget').CapWidget;
    host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(host);
    try {
      const cap = new Cap({ apiEndpoint: '/api/cap/' }, host);
      const result = await cap.solve();
      if (!result.token) throw new Error('Cap returned no token');
      return result.token;
    } finally {
      host.remove();
    }
  })().finally(() => {
    capSolvePromise = null;
  });
  return capSolvePromise;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  let capToken = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;
    if (capToken) headers['x-cap-token'] = capToken;

    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError('Unable to connect to CloudBox service', 0, 'NETWORK_ERROR');
    }

    if (!response.ok) {
      let payload: { code?: string; message?: string; details?: unknown; action?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // 闈?JSON 閿欒浣擄紙渚嬪缃戝叧閿欒椤碉級
      }
      if (response.status === 403 && payload.action === 'cap_required' && !capToken) {
        capToken = await solveCap();
        continue;
      }
      throw new ApiError(
        payload.message ?? `Request failed (HTTP ${response.status})`,
        response.status,
        payload.code ?? 'REQUEST_FAILED',
        payload.details,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  throw new ApiError('CAP_FAILED', 403, 'CAP_FAILED');
}

export function downloadUrl(path: string): string {
  return `/api/files/download?path=${encodeURIComponent(path)}`;
}

export function previewContentUrl(path: string): string {
  return `/api/files/preview/content?path=${encodeURIComponent(path)}`;
}

export function guestDownloadUrl(token: string, path: string): string {
  return `/api/public/guest/${encodeURIComponent(token)}/download?path=${encodeURIComponent(path)}`;
}

interface GuestRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

/**
 * 访客公开接口专用请求。
 * 不带 CSRF 头（访客没有普通会话），但必须 credentials:'include'，
 * 否则 cb_guest Cookie 不会随请求发送。
 */
async function guestRequest<T>(path: string, options: GuestRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
    });
  } catch {
    throw new ApiError('Unable to connect to CloudBox service', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    let payload: { code?: string; message?: string; details?: unknown } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // 非 JSON 错误体（例如网关错误页）
    }
    throw new ApiError(
      payload.message ?? `Request failed (HTTP ${response.status})`,
      response.status,
      payload.code ?? 'REQUEST_FAILED',
      payload.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  async publicSettings(): Promise<PublicSettings> {
    return request<PublicSettings>('/api/public/settings');
  },

  async register(username: string, password: string): Promise<PublicUser> {
    const result = await request<{ user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: { username, password },
    });
    return result.user;
  },

  async login(username: string, password: string): Promise<LoginResponse> {
    const result = await request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setCsrfToken(result.csrfToken);
    return result;
  },

  async me(): Promise<MeResponse> {
    const result = await request<MeResponse>('/api/auth/me');
    if (result.csrfToken) setCsrfToken(result.csrfToken);
    return result;
  },

  async logout(): Promise<void> {
    await request<void>('/api/auth/logout', { method: 'POST' });
    setCsrfToken('');
  },

  renameAccount(username: string): Promise<{ user: PublicUser }> {
    return request<{ user: PublicUser }>('/api/auth/username', {
      method: 'PATCH',
      body: { username },
    });
  },

  uploadAvatar(avatar: string): Promise<{ avatarDataUrl: string }> {
    return request<{ avatarDataUrl: string }>('/api/auth/avatar', {
      method: 'POST',
      body: { avatar },
    });
  },

  list(path: string): Promise<FileListing> {
    return request<FileListing>(`/api/files?path=${encodeURIComponent(path)}`);
  },

  usage(): Promise<UsageInfo> {
    return request<UsageInfo>('/api/files/usage');
  },

  createFolder(path: string, name: string): Promise<void> {
    return request<void>('/api/files/folder', {
      method: 'POST',
      body: { path, name },
    });
  },

  rename(path: string, newName: string): Promise<void> {
    return request<void>('/api/files', {
      method: 'PATCH',
      body: { path, newName },
    });
  },

  remove(paths: string[]): Promise<void> {
    return request<void>('/api/files', {
      method: 'DELETE',
      body: { paths },
    });
  },

  copy(paths: string[], destination: string): Promise<{ entries: FileEntry[] }> {
    return request<{ entries: FileEntry[] }>('/api/files/copy', {
      method: 'POST',
      body: { paths, destination },
    });
  },

  move(paths: string[], destination: string): Promise<{ entries: FileEntry[] }> {
    return request<{ entries: FileEntry[] }>('/api/files/move', {
      method: 'POST',
      body: { paths, destination },
    });
  },

  pluginPreviewers(): Promise<Record<string, string>> {
    return request<Record<string, string>>('/api/plugins/previewers');
  },

  previewInfo(path: string): Promise<PreviewInfo> {
    return request<PreviewInfo>(`/api/files/preview/info?path=${encodeURIComponent(path)}`);
  },

  previewText(path: string): Promise<TextPreview> {
    return request<TextPreview>(`/api/files/preview/content?path=${encodeURIComponent(path)}`);
  },

  pluginSlots(): Promise<PluginSlot[]> {
    return request<PluginSlot[]>('/api/plugins/slots');
  },

  announcements(): Promise<{ items: AnnouncementView[]; unread: number }> {
    return request<{ items: AnnouncementView[]; unread: number }>('/api/announcements');
  },

  markAnnouncementsRead(): Promise<void> {
    return request<void>('/api/announcements/read', { method: 'POST', body: {} });
  },

  listShares(): Promise<Array<{ id: number; token: string; path: string; url: string; file_path: string; expires_at: number; created_at: number; expired: boolean }>> {
    return request('/api/shares');
  },

  revokeShare(id: number): Promise<void> {
    return request<void>(`/api/shares/${id}`, { method: 'DELETE' });
  },

  createShare(filePath: string, durationSeconds: number): Promise<ShareCreated> {
    return request<ShareCreated>('/api/shares', {
      method: 'POST',
      body: { file_path: filePath, duration_seconds: durationSeconds },
    });
  },

  /** 用户侧访客链接管理（走普通会话 + CSRF） */
  guestStatus(): Promise<GuestStatus> {
    return request<GuestStatus>('/api/guest/status');
  },

  createGuestLink(password?: string): Promise<GuestLinkView> {
    return request<GuestLinkView>('/api/guest/link', {
      method: 'POST',
      body: password === undefined || password === '' ? {} : { password },
    });
  },

  revokeGuestLink(): Promise<void> {
    return request<void>('/api/guest/link', { method: 'DELETE' });
  },

  /** 访客公开接口（不需要登录，cb_guest Cookie 认证） */
  guestInfo(token: string): Promise<GuestPublicInfo> {
    return guestRequest<GuestPublicInfo>(`/api/public/guest/${encodeURIComponent(token)}`);
  },

  guestUnlock(token: string, password: string): Promise<GuestUnlockResult> {
    return guestRequest<GuestUnlockResult>(
      `/api/public/guest/${encodeURIComponent(token)}/unlock`,
      { method: 'POST', body: { password } },
    );
  },

  guestFiles(token: string, path: string): Promise<FileListing> {
    return guestRequest<FileListing>(
      `/api/public/guest/${encodeURIComponent(token)}/files?path=${encodeURIComponent(path)}`,
    );
  },

  guestDownloadUrl,

  extract(filePath: string, targetDir: string, password?: string): Promise<{ taskId: string }> {
    return request<{ taskId: string }>('/api/files/extract', {
      method: 'POST',
      body: { file_path: filePath, target_dir: targetDir, ...(password ? { password } : {}) },
    });
  },

  scan(filePath: string): Promise<{ taskId: string }> {
    return request<{ taskId: string }>('/api/files/scan', {
      method: 'POST',
      body: { path: filePath },
    });
  },

  compress(paths: string[], targetDir: string, archiveName: string, level: number, password?: string): Promise<{ taskId: string }> {
    return request<{ taskId: string }>('/api/files/compress', { method: 'POST', body: { paths, target_dir: targetDir, archive_name: archiveName, level, ...(password ? { password } : {}) } });
  },

  tasks(): Promise<BackgroundTask[]> {
    return request<BackgroundTask[]>('/api/tasks');
  },

  taskUsage(): Promise<Record<'extract' | 'scan' | 'compress', { users: number; running: number; queued: number; paused: number }>> {
    return request('/api/tasks/usage');
  },

  async cancelAllTasks(): Promise<void> {
    await fetch('/api/tasks/cancel-all', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
    });
  },

  restartTask(id: string): Promise<{ taskId: string }> {
    return request<{ taskId: string }>(`/api/tasks/${encodeURIComponent(id)}/restart`, { method: 'POST' });
  },

  pauseTask(id: string): Promise<BackgroundTask> {
    return request<BackgroundTask>(`/api/tasks/${encodeURIComponent(id)}/pause`, { method: 'POST' });
  },

  cancelTask(id: string): Promise<BackgroundTask> {
    return request<BackgroundTask>(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },

  taskStats(): Promise<{ running: number; queued: number; paused: number }> {
    return request<{ running: number; queued: number; paused: number }>('/api/tasks/stats');
  },

  clearTasks(): Promise<{ removed: number }> {
    return request<{ removed: number }>('/api/tasks', { method: 'DELETE' });
  },

  archiveEntries(path: string): Promise<Array<{ path: string; size: number; isDirectory: boolean }>> {
    return request<{ entries: Array<{ path: string; size: number; isDirectory: boolean }> }>(`/api/files/archive?path=${encodeURIComponent(path)}`).then((result) => result.entries);
  },

  searchFiles(query: string): Promise<FileEntry[]> {
    return request<{ entries: FileEntry[] }>(`/api/files/search?q=${encodeURIComponent(query)}`).then((result) => result.entries);
  },

  task(taskId: string): Promise<BackgroundTask> {
    return request<BackgroundTask>(`/api/tasks/${encodeURIComponent(taskId)}`);
  },

  hostingSettings(): Promise<HostingSettings> {
    return request<HostingSettings>('/api/hosting/settings');
  },

  saveHosting(input: {
    rootPath: string;
    enabled: boolean;
    visibility: 'public' | 'private';
  }): Promise<HostingSettings> {
    return request<HostingSettings>('/api/hosting/settings', { method: 'PUT', body: input });
  },

  disableHosting(): Promise<HostingSettings> {
    return request<HostingSettings>('/api/hosting/disable', { method: 'POST' });
  },

  aiSettings(): Promise<AiSettings> {
    return request<AiSettings>('/api/ai/settings');
  },

  saveAiSettings(input: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    dailyLimit?: number;
    workScope?: 'folder' | 'all';
    workDir?: string;
  }): Promise<AiSettings> {
    return request<AiSettings>('/api/ai/settings', { method: 'PUT', body: input });
  },

  confirmAiAction(actionId: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    return request(`/api/ai/actions/${encodeURIComponent(actionId)}/confirm`, { method: 'POST' });
  },

  async aiChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    onEvent: (event: AiStreamEvent) => void,
    locale = 'zh-CN',
  ): Promise<void> {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: JSON.stringify({ messages, locale }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(body?.message ?? 'AI 请求失败', response.status, 'AI_REQUEST_FAILED');
    }
    if (!response.body) throw new ApiError('AI 响应流不可用', 500, 'AI_STREAM_FAILED');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((item) => item.startsWith('data: '));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as AiStreamEvent);
        } catch {
          // 忽略不完整事件
        }
      }
    }
  },
};

export interface UploadFileOptions {
  file: File;
  path: string;
  overwrite?: boolean;
  onProgress?: (ratio: number) => void;
  /** 供 UI 注册取消函数 */
  onAbortReady?: (abort: () => void) => void;
}

/**
 * 上传必须使用 XMLHttpRequest：fetch 目前无法可靠获取上传进度。
 * 返回 Promise，取消时 reject 一个 code=UPLOAD_ABORTED 的 ApiError。
 */
export function uploadFile(options: UploadFileOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({ path: options.path });
    if (options.overwrite) params.set('overwrite', '1');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files/upload?${params.toString()}`);
    xhr.withCredentials = true;

    if (csrfToken) {
      xhr.setRequestHeader('x-csrf-token', csrfToken);
    }

    let stallTimer: number | null = null;
    const resetStallTimer = (): void => {
      if (stallTimer !== null) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        xhr.abort();
        reject(new ApiError('上传长时间无响应，已停止；请检查网络后重试', 0, 'UPLOAD_STALLED'));
      }, 90_000);
    };
    resetStallTimer();
    xhr.upload.onprogress = (event) => {
      resetStallTimer();
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };
    const clearStall = (): void => { if (stallTimer !== null) { window.clearTimeout(stallTimer); stallTimer = null; } };

    xhr.onload = () => {
      clearStall();
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        resolve();
        return;
      }

      let payload: { code?: string; message?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        // 忽略非 JSON 响应
      }
      reject(
        new ApiError(
          payload.message ?? `上传失败（HTTP ${xhr.status}）`,
          xhr.status,
          payload.code ?? 'UPLOAD_FAILED',
        ),
      );
    };

    xhr.onerror = () => { clearStall(); reject(new ApiError('网络中断，上传失败', 0, 'NETWORK_ERROR')); };
    xhr.onabort = () => { clearStall(); reject(new ApiError('已取消上传', 0, 'UPLOAD_ABORTED')); };
    xhr.ontimeout = () => { clearStall(); reject(new ApiError('上传超时，请重试', 0, 'UPLOAD_TIMEOUT')); };

    options.onAbortReady?.(() => xhr.abort());

    const form = new FormData();
    form.append('file', options.file);
    xhr.send(form);
  });
}
