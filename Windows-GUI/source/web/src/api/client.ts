export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
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
  kind: 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'none';
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
    allow_user_extract: boolean;
    allow_user_scan: boolean;
  };
  scan_enabled: boolean;
  ai_enabled: boolean;
  ai_mode: 'admin' | 'user';
  mcp_enabled: boolean;
  hosting_enabled: boolean;
  hosting_base_url: string;
}

export interface HostingSettings {
  enabled: boolean;
  rootPath: string;
  visibility: 'public' | 'private';
  url: string;
  hostingEnabled: boolean;
  baseUrl: string;
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
  type: 'extract' | 'scan';
  status:
    | 'pending'
    | 'running'
    | 'scanning'
    | 'clean'
    | 'infected'
    | 'completed'
    | 'failed';
  result: unknown;
  error: string | null;
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (csrfToken && method !== 'GET') {
    headers['x-csrf-token'] = csrfToken;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('无法连接服务器，请确认 CloudBox 服务已启动', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    let payload: { code?: string; message?: string; details?: unknown } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // 非 JSON 错误体（例如网关错误页）
    }
    throw new ApiError(
      payload.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      payload.code ?? 'REQUEST_FAILED',
      payload.details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function downloadUrl(path: string): string {
  return `/api/files/download?path=${encodeURIComponent(path)}`;
}

export function previewContentUrl(path: string): string {
  return `/api/files/preview/content?path=${encodeURIComponent(path)}`;
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

  previewInfo(path: string): Promise<PreviewInfo> {
    return request<PreviewInfo>(`/api/files/preview/info?path=${encodeURIComponent(path)}`);
  },

  previewText(path: string): Promise<TextPreview> {
    return request<TextPreview>(`/api/files/preview/content?path=${encodeURIComponent(path)}`);
  },

  createShare(filePath: string, durationSeconds: number): Promise<ShareCreated> {
    return request<ShareCreated>('/api/shares', {
      method: 'POST',
      body: { file_path: filePath, duration_seconds: durationSeconds },
    });
  },

  extract(filePath: string, targetDir: string): Promise<{ taskId: string }> {
    return request<{ taskId: string }>('/api/files/extract', {
      method: 'POST',
      body: { file_path: filePath, target_dir: targetDir },
    });
  },

  scan(filePath: string): Promise<{ taskId: string }> {
    return request<{ taskId: string }>('/api/files/scan', {
      method: 'POST',
      body: { path: filePath },
    });
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

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };

    xhr.onload = () => {
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

    xhr.onerror = () => reject(new ApiError('网络中断，上传失败', 0, 'NETWORK_ERROR'));
    xhr.onabort = () => reject(new ApiError('已取消上传', 0, 'UPLOAD_ABORTED'));

    options.onAbortReady?.(() => xhr.abort());

    const form = new FormData();
    form.append('file', options.file);
    xhr.send(form);
  });
}
