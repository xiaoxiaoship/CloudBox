import { create } from 'zustand';
import {
  ApiError,
  api,
  uploadFile,
  type FileEntry,
  type PublicUser,
  type UsageInfo,
} from '../api/client.ts';
import {
  readStoredTheme,
  writeStoredTheme,
  type ThemePreference,
} from '../lib/theme.ts';
import i18n from '../i18n.ts';

export type UploadStatus = 'uploading' | 'success' | 'error' | 'canceled';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: UploadStatus;
  error?: string;
}

interface AppState {
  initialized: boolean;
  user: PublicUser | null;
  usage: UsageInfo | null;
  currentPath: string;
  entries: FileEntry[];
  listingLoading: boolean;
  error: string | null;
  selected: string[];
  uploads: UploadItem[];
  /** 目录是否被截断（超过 5000 项） */
  truncated: boolean;
  theme: ThemePreference;
  audioQueue: FileEntry[];
  audioIndex: number;
  audioOpen: boolean;
  audioPlaying: boolean;

  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  renameAccount: (username: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  load: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  navigate: (path: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  rename: (path: string, newName: string) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;
  cancelUpload: (id: string) => void;
  clearFinishedUploads: () => void;
  toggleSelected: (path: string) => void;
  setSelected: (paths: string[]) => void;
  clearSelection: () => void;
  dismissError: () => void;
  setTheme: (theme: ThemePreference) => void;
  playAudio: (entry: FileEntry, queue: FileEntry[]) => void;
  setAudioIndex: (index: number) => void;
  toggleAudio: () => void;
  nextAudio: () => void;
  prevAudio: () => void;
  closeAudio: () => void;
  setAudioOpen: (open: boolean) => void;
}

/** 上传取消句柄不放进 state，避免触发无意义的渲染 */
const uploadAborts = new Map<string, () => void>();
let bootstrapPromise: Promise<void> | null = null;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    return i18n.exists(key) ? i18n.t(key) : error.message;
  }
  if (error instanceof Error) return error.message;
  return i18n.t('errors.NETWORK_ERROR');
}

export const useAppStore = create<AppState>()((set, get) => ({
  initialized: false,
  user: null,
  usage: null,
  currentPath: '',
  entries: [],
  listingLoading: false,
  error: null,
  selected: [],
  uploads: [],
  truncated: false,
  theme: readStoredTheme(),
  audioQueue: [],
  audioIndex: 0,
  audioOpen: false,
  audioPlaying: false,

  init: async () => {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      try {
        const me = await api.me();
        set({ user: me.user, usage: me.usage, initialized: true });
        await get().load('');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          set({ user: null, initialized: true });
        } else {
          set({ user: null, initialized: true, error: errorMessage(error) });
        }
      }
    })();

    return bootstrapPromise;
  },

  login: async (username, password) => {
    const result = await api.login(username, password);
    set({ user: result.user, error: null });
    await get().load('');
  },

  renameAccount: async (username) => {
    const result = await api.renameAccount(username);
    set({ user: result.user, error: null });
  },

  uploadAvatar: async (file) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error(i18n.t('errors.AVATAR_INVALID'));
    }
    if (file.size > 600 * 1024) {
      throw new Error(i18n.t('errors.AVATAR_TOO_LARGE'));
    }
    const avatar = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('头像读取失败'));
      reader.readAsDataURL(file);
    });
    const result = await api.uploadAvatar(avatar);
    const current = get().user;
    if (current) set({ user: { ...current, avatarDataUrl: result.avatarDataUrl } });
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      // 服务端不可达时仍然清理本地状态
    }
    for (const abort of uploadAborts.values()) abort();
    uploadAborts.clear();

    set({
      user: null,
      usage: null,
      entries: [],
      currentPath: '',
      selected: [],
      uploads: [],
      error: null,
      truncated: false,
    });
  },

  load: async (path) => {
    set({ listingLoading: true, error: null });

    try {
      const [listing, usage] = await Promise.all([api.list(path), api.usage()]);
      set({
        entries: listing.entries,
        currentPath: listing.path,
        truncated: listing.truncated,
        usage,
        selected: [],
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ user: null, entries: [], selected: [] });
      } else {
        set({ error: errorMessage(error) });
      }
    } finally {
      set({ listingLoading: false });
    }
  },

  refresh: async () => {
    await get().load(get().currentPath);
  },

  navigate: async (path) => {
    await get().load(path);
  },

  createFolder: async (name) => {
    await api.createFolder(get().currentPath, name);
    await get().refresh();
  },

  rename: async (path, newName) => {
    await api.rename(path, newName);
    await get().refresh();
  },

  remove: async (paths) => {
    await api.remove(paths);
    await get().refresh();
  },

  uploadFiles: async (files) => {
    if (files.length === 0) return;

    const targetPath = get().currentPath;

    for (const file of files) {
      const id = createId();
      const update = (patch: Partial<UploadItem>): void => {
        set((state) => ({
          uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        }));
      };

      set((state) => ({
        uploads: [
          ...state.uploads,
          { id, name: file.name, size: file.size, progress: 0, status: 'uploading' },
        ],
      }));

      try {
        await uploadFile({
          file,
          path: targetPath,
          onProgress: (ratio) => update({ progress: ratio }),
          onAbortReady: (abort) => uploadAborts.set(id, abort),
        });

        update({ status: 'success', progress: 1 });
        await get().refresh();
      } catch (error) {
        const canceled = error instanceof ApiError && error.code === 'UPLOAD_ABORTED';
        update({
          status: canceled ? 'canceled' : 'error',
          error: canceled ? '已取消' : errorMessage(error),
        });
      } finally {
        uploadAborts.delete(id);
      }
    }
  },

  cancelUpload: (id) => {
    uploadAborts.get(id)?.();
  },

  clearFinishedUploads: () => {
    set((state) => ({
      uploads: state.uploads.filter((item) => item.status === 'uploading'),
    }));
  },

  toggleSelected: (path) => {
    set((state) => ({
      selected: state.selected.includes(path)
        ? state.selected.filter((item) => item !== path)
        : [...state.selected, path],
    }));
  },

  setSelected: (paths) => {
    set({ selected: paths });
  },

  clearSelection: () => {
    set({ selected: [] });
  },

  dismissError: () => {
    set({ error: null });
  },

  setTheme: (theme) => {
    writeStoredTheme(theme);
    set({ theme });
  },

  playAudio: (entry, queue) => {
    const index = Math.max(0, queue.findIndex((item) => item.path === entry.path));
    set({
      audioQueue: queue.length > 0 ? queue : [entry],
      audioIndex: index,
      audioOpen: true,
      audioPlaying: true,
    });
  },
  setAudioIndex: (index) => set({ audioIndex: index, audioPlaying: true }),
  toggleAudio: () => set((state) => ({ audioPlaying: !state.audioPlaying })),
  nextAudio: () => set((state) => ({
    audioIndex: state.audioQueue.length === 0 ? 0 : (state.audioIndex + 1) % state.audioQueue.length,
    audioPlaying: true,
  })),
  prevAudio: () => set((state) => ({
    audioIndex: state.audioQueue.length === 0
      ? 0
      : (state.audioIndex - 1 + state.audioQueue.length) % state.audioQueue.length,
    audioPlaying: true,
  })),
  closeAudio: () => set({ audioOpen: false, audioPlaying: false }),
  setAudioOpen: (open) => set({ audioOpen: open }),
}));
