import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import { hashPassword, verifyPassword } from '../security/password.ts';
import { toSessionUser, type SessionUser } from '../types/models.ts';
import type { SettingsService } from './settingsService.ts';

/**
 * 访客模式（只读访客直链）。
 *
 * 设计要点：
 *  - 每个账号最多一条有效链接，链接持久化在 storageRoot/.guest-links.json
 *  - 访客会话只存在内存 Map（不写普通 sessions 表），TTL 30 分钟，绑定链接 token
 *  - 撤销链接 / 链接过期会立即让该链接下的所有访客会话失效
 *  - 全部公开能力都是只读：列表 / 下载走 FileService，不提供任何写入入口
 */

export const GUEST_ERROR = {
  DISABLED: 'GUEST_DISABLED',
  NOT_FOUND: 'GUEST_LINK_NOT_FOUND',
  EXPIRED: 'GUEST_LINK_EXPIRED',
  PASSWORD_INVALID: 'GUEST_PASSWORD_INVALID',
  SESSION_INVALID: 'GUEST_SESSION_INVALID',
  TOO_MANY_SESSIONS: 'GUEST_TOO_MANY_SESSIONS',
  USER_INVALID: 'GUEST_USER_INVALID',
} as const;

export type GuestErrorCode = (typeof GUEST_ERROR)[keyof typeof GUEST_ERROR];

export class GuestError extends Error {
  readonly code: GuestErrorCode;
  readonly httpStatus: number;

  constructor(code: GuestErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'GuestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 访客会话固定 30 分钟，且不会超过链接本身的剩余有效期 */
export const GUEST_SESSION_TTL_MS = 30 * 60_000;

const GUEST_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const GUEST_TOKEN_RE = GUEST_TOKEN_PATTERN;

export interface GuestLinkRecord {
  userId: number;
  token: string;
  /** 可选访问密码的 scrypt 哈希；null 表示无密码 */
  passwordHash: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface GuestLinkView {
  token: string;
  hasPassword: boolean;
  expiresAt: number;
}

export interface GuestLinkStatus {
  enabled: boolean;
  link: GuestLinkView | null;
}

export interface GuestPublicInfo {
  ownerUsername: string;
  hasPassword: boolean;
  expiresAt: number;
}

export interface GuestSession {
  /** cookie 里携带的随机会话标识（不是链接 token） */
  id: string;
  /** 绑定的访客链接 token */
  linkToken: string;
  userId: number;
  createdAt: number;
  expiresAt: number;
}

export interface GuestUnlockResult {
  sessionToken: string;
  expiresAt: number;
  link: GuestLinkRecord;
  owner: SessionUser;
}

export interface GuestSessionResolution {
  session: GuestSession;
  link: GuestLinkRecord;
  owner: SessionUser;
}

interface GuestLinkServiceOptions {
  users: UserRepository;
  settings: SettingsService;
  storageRoot: string;
  now?: () => number;
}

interface PersistedGuestLink {
  userId: number;
  token: string;
  passwordHash: string | null;
  createdAt: number;
  expiresAt: number;
}

function viewOf(link: GuestLinkRecord): GuestLinkView {
  return {
    token: link.token,
    hasPassword: link.passwordHash !== null,
    expiresAt: link.expiresAt,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePersistedLink(value: unknown): GuestLinkRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<PersistedGuestLink>;
  if (!Number.isSafeInteger(row.userId) || (row.userId ?? 0) <= 0) return null;
  if (typeof row.token !== 'string' || !GUEST_TOKEN_PATTERN.test(row.token)) return null;
  if (!isFiniteNumber(row.createdAt) || !isFiniteNumber(row.expiresAt)) return null;
  if (row.expiresAt !== 0 && row.expiresAt <= row.createdAt) return null;
  const passwordHash = typeof row.passwordHash === 'string' ? row.passwordHash : null;
  return {
    userId: row.userId as number,
    token: row.token,
    passwordHash,
    createdAt: Math.trunc(row.createdAt as number),
    expiresAt: Math.trunc(row.expiresAt as number),
  };
}

/**
 * 访客链接与会话状态。
 * 链接落盘（跨重启有效），会话只在内存（重启即失效，符合"短时访客"定位）。
 */
export class GuestLinkService {
  private readonly users: UserRepository;
  private readonly settings: SettingsService;
  private readonly now: () => number;
  private readonly storeFile: string;

  /** userId -> link */
  private readonly links = new Map<number, GuestLinkRecord>();
  /** token -> userId，便于按 URL token 反查 */
  private readonly tokenIndex = new Map<string, number>();
  /** guest session id -> session */
  private readonly sessions = new Map<string, GuestSession>();

  constructor(options: GuestLinkServiceOptions) {
    this.users = options.users;
    this.settings = options.settings;
    this.now = options.now ?? Date.now;
    this.storeFile = path.join(options.storageRoot, '.guest-links.json');
    this.load();
  }

  isEnabled(): boolean {
    return this.settings.get('allow_guest_mode');
  }

  status(user: SessionUser): GuestLinkStatus {
    const enabled = this.isEnabled();
    const link = this.links.get(user.id) ?? null;
    if (link === null) return { enabled, link: null };
    if (link.expiresAt > 0 && this.now() > link.expiresAt) {
      this.dropLink(link);
      return { enabled, link: null };
    }
    return { enabled, link: viewOf(link) };
  }

  /**
   * 创建或覆盖当前账号的访客链接。
   * @param password 可选访问密码；空字符串 / null 表示无密码
   */
  async create(user: SessionUser, password: string | null): Promise<GuestLinkRecord> {
    if (!this.isEnabled()) {
      throw new GuestError(GUEST_ERROR.DISABLED, '管理员已关闭访客模式', 403);
    }

    const existing = this.links.get(user.id) ?? null;
    if (existing !== null) this.dropLink(existing);

    const now = this.now();
    const ttlHours = this.settings.getLowLevel().guestLinkTtlHours;
    const passwordHash = password === null || password === '' ? null : await hashPassword(password);
    const link: GuestLinkRecord = {
      userId: user.id,
      token: randomBytes(32).toString('hex'),
      passwordHash,
      createdAt: now,
      expiresAt: ttlHours === 0 ? 0 : now + ttlHours * 3_600_000,
    };
    this.links.set(link.userId, link);
    this.tokenIndex.set(link.token, link.userId);
    this.save();
    return { ...link };
  }

  /** 撤销当前账号的访客链接，并让该链接下的所有访客会话立即失效 */
  revoke(userId: number): boolean {
    const link = this.links.get(userId) ?? null;
    if (link === null) return false;
    this.dropLink(link);
    return true;
  }

  /** 公开信息：只暴露 owner 用户名、是否有密码、过期时间 */
  info(token: string): GuestPublicInfo {
    const link = this.resolveLink(token);
    const user = this.requireOwner(link);
    return {
      ownerUsername: user.username,
      hasPassword: link.passwordHash !== null,
      expiresAt: link.expiresAt,
    };
  }

  /**
   * 校验访问密码并签发短时访客会话。
   * 无密码链接直接签发；有密码链接密码错误抛 GUEST_PASSWORD_INVALID。
   */
  async unlock(token: string, password: string): Promise<GuestUnlockResult> {
    if (!this.isEnabled()) {
      throw new GuestError(GUEST_ERROR.DISABLED, '管理员已关闭访客模式', 403);
    }

    const link = this.resolveLink(token);
    const owner = this.requireOwner(link);

    if (link.passwordHash !== null) {
      const ok = await verifyPassword(password, link.passwordHash);
      if (!ok) {
        throw new GuestError(GUEST_ERROR.PASSWORD_INVALID, '访问密码不正确', 429);
      }
    }

    const now = this.now();
    this.pruneSessions();

    const maxConcurrent = this.settings.getLowLevel().guestMaxConcurrent;
    let active = 0;
    for (const session of this.sessions.values()) {
      if (session.linkToken === link.token) active += 1;
    }
    if (active >= maxConcurrent) {
      throw new GuestError(
        GUEST_ERROR.TOO_MANY_SESSIONS,
        `访客人数已达上限（${maxConcurrent} 人），请稍后再试`,
        429,
      );
    }

    const sessionToken = randomBytes(32).toString('hex');
    const session: GuestSession = {
      id: sessionToken,
      linkToken: link.token,
      userId: link.userId,
      createdAt: now,
      expiresAt: link.expiresAt === 0 ? now + GUEST_SESSION_TTL_MS : Math.min(now + GUEST_SESSION_TTL_MS, link.expiresAt),
    };
    this.sessions.set(sessionToken, session);

    return { sessionToken, expiresAt: session.expiresAt, link, owner };
  }

  /**
   * 校验访客会话（cookie 值）。
   * 链接被撤销或过期后，任何旧的访客会话都视为无效。
   */
  validateSession(sessionToken: string): GuestSessionResolution {
    if (!this.isEnabled()) {
      throw new GuestError(GUEST_ERROR.DISABLED, '管理员已关闭访客模式', 403);
    }
    if (typeof sessionToken !== 'string' || !GUEST_TOKEN_PATTERN.test(sessionToken)) {
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }

    const session = this.sessions.get(sessionToken) ?? null;
    if (session === null) {
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }
    if (this.now() > session.expiresAt) {
      this.sessions.delete(sessionToken);
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }

    let link: GuestLinkRecord;
    try {
      link = this.resolveLink(session.linkToken);
    } catch {
      this.sessions.delete(sessionToken);
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }
    if (link.userId !== session.userId) {
      this.sessions.delete(sessionToken);
      throw new GuestError(GUEST_ERROR.SESSION_INVALID, '访客会话无效或已过期', 401);
    }

    return { session, link, owner: this.requireOwner(link) };
  }

  /** 该链接当前活跃访客会话数（供监控 / 测试使用） */
  activeSessionCount(token: string): number {
    this.pruneSessions();
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.linkToken === token) count += 1;
    }
    return count;
  }

  private resolveLink(token: string): GuestLinkRecord {
    if (typeof token !== 'string' || !GUEST_TOKEN_PATTERN.test(token)) {
      throw new GuestError(GUEST_ERROR.NOT_FOUND, '访客链接不存在', 404);
    }
    const userId = this.tokenIndex.get(token);
    const link = userId === undefined ? null : (this.links.get(userId) ?? null);
    if (link === null || link.token !== token) {
      throw new GuestError(GUEST_ERROR.NOT_FOUND, '访客链接不存在', 404);
    }
    if (link.expiresAt > 0 && this.now() > link.expiresAt) {
      this.dropLink(link);
      throw new GuestError(GUEST_ERROR.EXPIRED, '访客链接已过期', 410);
    }
    return link;
  }

  private requireOwner(link: GuestLinkRecord): SessionUser {
    const user = this.users.findById(link.userId);
    if (user === null || user.status !== 'active') {
      this.dropLink(link);
      throw new GuestError(GUEST_ERROR.USER_INVALID, '访客链接对应的账号不可用', 404);
    }
    return toSessionUser(user);
  }

  private pruneSessions(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) this.sessions.delete(id);
    }
  }

  /** 删除链接并连带清理其全部访客会话 */
  private dropLink(link: GuestLinkRecord): void {
    const stored = this.links.get(link.userId) ?? null;
    if (stored === null || stored.token !== link.token) return;
    this.links.delete(link.userId);
    this.tokenIndex.delete(link.token);
    for (const [id, session] of this.sessions) {
      if (session.linkToken === link.token) this.sessions.delete(id);
    }
    this.save();
  }

  private load(): void {
    if (!existsSync(this.storeFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.storeFile, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return;
      const now = this.now();
      for (const entry of raw) {
        const link = parsePersistedLink(entry);
        if (link === null) continue;
        if (link.expiresAt > 0 && now > link.expiresAt) continue;
        // 同一账号只保留一条（取文件中最后出现的一条）
        const previous = this.links.get(link.userId);
        if (previous !== undefined) this.tokenIndex.delete(previous.token);
        this.links.set(link.userId, link);
        this.tokenIndex.set(link.token, link.userId);
      }
    } catch {
      // 损坏的链接文件按"无访客链接"处理，不影响主服务
    }
  }

  private save(): void {
    try {
      const rows = [...this.links.values()];
      writeFileSync(this.storeFile, JSON.stringify(rows, null, 2), 'utf8');
    } catch {
      // 落盘失败只影响重启后的链接可用性，不应让请求失败
    }
  }
}
