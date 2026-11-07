import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { HostingRecord, HostingRepository } from '../db/repositories/hostingRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import type { SessionUser } from '../types/models.ts';
import { toSessionUser } from '../types/models.ts';
import { normalizeRelativePath, resolveUserPath } from '../security/safePath.ts';
import type { FileService, RequestContext } from './fileService.ts';
import type { SettingsService } from './settingsService.ts';

export interface HostingSettings {
  enabled: boolean;
  rootPath: string;
  visibility: 'public' | 'private';
  url: string;
  hostingEnabled: boolean;
  baseUrl: string;
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

  urlFor(user: { username: string }): string {
    const base = this.settings.get('hosting.base_url').trim().replace(/\/+$/, '');
    return `${base}/host/${encodeURIComponent(user.username)}/`;
  }

  get(user: SessionUser): HostingSettings {
    const record = this.repo.get(user.id);
    return {
      enabled: record?.enabled ?? false,
      rootPath: record?.rootPath ?? '',
      visibility: record?.visibility ?? 'private',
      url: this.urlFor(user),
      hostingEnabled: this.isEnabled(),
      baseUrl: this.settings.get('hosting.base_url'),
    };
  }

  async save(
    user: SessionUser,
    input: { rootPath: string; enabled: boolean; visibility: 'public' | 'private' },
    ctx: RequestContext,
  ): Promise<HostingSettings> {
    if (!this.isEnabled()) throw new Error('管理员尚未开启静态托管');
    const rootPath = input.rootPath.trim();
    if (rootPath === '') throw new Error('请选择站点根目录');
    const normalized = normalizeRelativePath(rootPath);

    // 目录必须真实存在，必须是目录
    await this.files.list(user, normalized, ctx);
    if (input.enabled && !existsSync(path.join(this.storageRoot, user.storageKey, ...normalized.split('/'), 'index.html'))) {
      throw new Error('站点根目录缺少 index.html，请先上传 index.html 再部署');
    }

    const record: HostingRecord = {
      userId: user.id,
      rootPath: normalized,
      enabled: input.enabled,
      visibility: input.visibility,
      updatedAt: this.now(),
    };
    this.repo.upsert(record);
    return this.get(user);
  }

  disable(user: SessionUser): HostingSettings {
    const existing = this.repo.get(user.id);
    if (existing) {
      this.repo.upsert({ ...existing, enabled: false, updatedAt: this.now() });
    }
    return this.get(user);
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
