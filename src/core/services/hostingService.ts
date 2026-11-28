import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { HostingRecord, HostingRepository } from '../db/repositories/hostingRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import { FILE_ERROR, FileServiceError } from './fileService.ts';
import type { SessionUser } from '../types/models.ts';
import { toSessionUser } from '../types/models.ts';
import { normalizeRelativePath, resolveUserPath } from '../security/safePath.ts';
import type { FileService, RequestContext } from './fileService.ts';
import type { SettingsService } from './settingsService.ts';

export type HostingMode = 'auto' | 'public';

/** 当前 HTTP 请求的协议与 Host，用于 auto 模式生成绝对地址。 */
export interface RequestOrigin {
  protocol: 'http' | 'https';
  host: string;
}

export interface HostingSettings {
  enabled: boolean;
  rootPath: string;
  visibility: 'public' | 'private';
  url: string;
  hostingEnabled: boolean;
  baseUrl: string;
  mode: HostingMode;
}

export class HostingService {
  private readonly repo: HostingRepository;
  private readonly users: UserRepository;
  private readonly files: FileService;
  private readonly settings: SettingsService;
  private readonly storageRoot: string;
  private readonly now: () => number;

  constructor(options: {
    repo: HostingRepository;
    users: UserRepository;
    files: FileService;
    settings: SettingsService;
    storageRoot: string;
    now?: () => number;
  }) {
    this.repo = options.repo;
    this.users = options.users;
    this.files = options.files;
    this.settings = options.settings;
    this.storageRoot = options.storageRoot;
    this.now = options.now ?? Date.now;
  }

  isEnabled(): boolean {
    return this.settings.get('hosting.enabled');
  }

  /** 公网固定基础地址（已去除末尾斜杠），未配置时返回空串。 */
  configuredBaseUrl(): string {
    return this.settings.get('hosting.base_url').trim().replace(/\/+$/, '');
  }

  mode(): HostingMode {
    return this.settings.get('hosting.mode');
  }

  /**
   * 链接基础地址：
   *  - public 模式且配置了 base_url：优先使用公网固定地址；
   *  - 其余情况（auto 模式或未配置公网地址）：使用当前请求的协议 + Host；
   *  - 没有请求上下文时退回已配置的 base_url，避免拼出 "undefined"。
   */
  resolveBaseUrl(origin?: RequestOrigin | null, mode?: HostingMode): string {
    const configured = this.configuredBaseUrl();
    if ((mode ?? this.mode()) === 'public' && configured !== '') return configured;
    if (origin && origin.host !== '') return `${origin.protocol}://${origin.host}`;
    return configured;
  }

  /** 拼接绝对地址；没有可用基础地址时保留以 "/" 开头的相对路径。 */
  absoluteUrl(pathname: string, origin?: RequestOrigin | null, mode?: HostingMode): string {
    const base = this.resolveBaseUrl(origin, mode);
    return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  }

  urlFor(user: { username: string }, origin?: RequestOrigin | null): string {
    return this.absoluteUrl(`/host/${encodeURIComponent(user.username)}/`, origin);
  }

  get(user: SessionUser, origin?: RequestOrigin | null): HostingSettings {
    const record = this.repo.get(user.id);
    return {
      enabled: record?.enabled ?? false,
      rootPath: record?.rootPath ?? '',
      visibility: record?.visibility ?? 'private',
      url: this.urlFor(user, origin),
      hostingEnabled: this.isEnabled(),
      baseUrl: this.settings.get('hosting.base_url'),
      mode: this.mode(),
    };
  }

  async save(
    user: SessionUser,
    input: { rootPath: string; enabled: boolean; visibility: 'public' | 'private' },
    ctx: RequestContext,
    origin?: RequestOrigin | null,
  ): Promise<HostingSettings> {
    if (!this.isEnabled()) throw new Error('管理员尚未开启静态托管');
    const rootPath = input.rootPath.trim();
    if (rootPath === '') throw new Error('请选择站点根目录');
    const normalized = normalizeRelativePath(rootPath);

    // 目录必须真实存在，必须是目录
    await this.files.list(user, normalized, ctx);
    if (input.enabled && !existsSync(path.join(this.storageRoot, user.storageKey, ...normalized.split('/'), 'index.html'))) {
      throw new FileServiceError(
        FILE_ERROR.INVALID_OPERATION,
        '站点根目录缺少 index.html，请先上传 index.html 再部署',
        400,
      );
    }

    const record: HostingRecord = {
      userId: user.id,
      rootPath: normalized,
      enabled: input.enabled,
      visibility: input.visibility,
      updatedAt: this.now(),
    };
    this.repo.upsert(record);
    return this.get(user, origin);
  }

  disable(user: SessionUser, origin?: RequestOrigin | null): HostingSettings {
    const existing = this.repo.get(user.id);
    if (existing) {
      this.repo.upsert({ ...existing, enabled: false, updatedAt: this.now() });
    }
    return this.get(user, origin);
  }

  findByUsername(username: string): {
    owner: SessionUser;
    record: HostingRecord;
    rootAbsolute: string;
  } | null {
    if (!this.isEnabled()) return null;
    const found = this.repo.findByUsername(username);
    if (!found) return null;
    const user = this.users.findById(found.user as number);
    if (!user) return null;
    const owner = toSessionUser(user);
    return {
      owner,
      record: found.record,
      rootAbsolute: path.join(this.storageRoot, user.storageKey, ...found.record.rootPath.split('/')),
    };
  }

  resolveRequest(
    username: string,
    requestPath: string,
    viewer: SessionUser | null,
  ): { absolutePath: string; owner: SessionUser; mimeHint: string } | null {
    const site = this.findByUsername(username);
    if (!site || !site.record.enabled) return null;
    if (site.record.visibility === 'private' && viewer?.id !== site.owner.id) return null;

    let clean: string;
    try {
      clean = normalizeRelativePath(requestPath.replace(/^\/+/, ''));
    } catch {
      return null;
    }
    let target: { absolutePath: string; relativePath: string } | null = null;
    try {
      target = resolveUserPath(site.rootAbsolute, clean, { mustExist: true });
    } catch {
      target = null;
    }

    const rootIndex = path.join(site.rootAbsolute, 'index.html');
    if (target !== null && existsSync(target.absolutePath)) {
      try {
        const stat = statSync(target.absolutePath);
        if (stat.isDirectory()) {
          return { absolutePath: path.join(target.absolutePath, 'index.html'), owner: site.owner, mimeHint: '.html' };
        }
      } catch {
        return null;
      }
      return { absolutePath: target.absolutePath, owner: site.owner, mimeHint: path.extname(target.absolutePath) };
    }

    // SPA 回退：无扩展名才回退，避免把缺失的 .js/.css 错误返回 HTML
    if (path.extname(clean) === '' && existsSync(rootIndex)) {
      return { absolutePath: rootIndex, owner: site.owner, mimeHint: '.html' };
    }
    return null;
  }
}
