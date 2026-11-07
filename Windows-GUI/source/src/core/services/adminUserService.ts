import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/connection.ts';
import type { QuotaRepository } from '../db/repositories/quotaRepo.ts';
import type { SessionRepository } from '../db/repositories/sessionRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import {
  checkPasswordStrength,
  hashPassword,
} from '../security/password.ts';
import {
  toPublicUser,
  type PublicUser,
  type UserRecord,
  type UserStatus,
} from '../types/models.ts';
import type { AuthService } from './authService.ts';
import type { AuditService } from './auditService.ts';

export interface ManagedUser extends PublicUser {
  quotaBytes: number | null;
  usedBytes: number;
  failedAttempts: number;
  lockedUntil: number | null;
}

export interface AdminActor {
  id: number;
  username: string;
}

export const ADMIN_ERROR = {
  ADMIN_EXISTS: 'ADMIN_EXISTS',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_USERNAME: 'INVALID_USERNAME',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  INVALID_QUOTA: 'INVALID_QUOTA',
  FORBIDDEN: 'FORBIDDEN',
} as const;

export type AdminErrorCode = (typeof ADMIN_ERROR)[keyof typeof ADMIN_ERROR];

export class AdminError extends Error {
  readonly code: AdminErrorCode;

  constructor(code: AdminErrorCode, message: string) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
  }
}

const MAX_QUOTA_BYTES = 1024 ** 5; // 1 PiB，足够大且避免整数溢出
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function normalizeUsername(value: string): string {
  const username = value.trim();
  if (!/^[^\s/\\:*?"<>|]{1,64}$/u.test(username)) {
    throw new AdminError(
      ADMIN_ERROR.INVALID_USERNAME,
      '用户名不合法：1-64 个字符，不能包含空格及 / \\ : * ? " < > |',
    );
  }
  return username;
}

function assertPassword(password: string): void {
  const result = checkPasswordStrength(password);
  if (!result.ok) {
    throw new AdminError(ADMIN_ERROR.WEAK_PASSWORD, `密码强度不足：${result.issues.join('；')}`);
  }
}

function assertQuota(quotaBytes: number | null): void {
  if (quotaBytes === null) return;
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 0 || quotaBytes > MAX_QUOTA_BYTES) {
    throw new AdminError(ADMIN_ERROR.INVALID_QUOTA, '配额必须是 0 到 1 PiB 之间的整数');
  }
}

export interface AdminUserServiceOptions {
  db: Db;
  users: UserRepository;
  quotas: QuotaRepository;
  sessions: SessionRepository;
  auth: AuthService;
  audit: AuditService;
  storageRoot: string;
  now?: () => number;
}

/**
 * 管理员侧账户管理：
 *  - 用户创建与配额
 *  - 重置密码（强制下次改密）
 *  - 禁用/启用（禁用时强制下线）
 *  - 删除账户（可选删除文件）
 *  - 首次运行创建唯一管理员
 */
export class AdminUserService {
  private readonly db: Db;
  private readonly users: UserRepository;
  private readonly quotas: QuotaRepository;
  private readonly sessions: SessionRepository;
  private readonly auth: AuthService;
  private readonly audit: AuditService;
  private readonly storageRoot: string;
  private readonly now: () => number;

  constructor(options: AdminUserServiceOptions) {
    this.db = options.db;
    this.users = options.users;
    this.quotas = options.quotas;
    this.sessions = options.sessions;
    this.auth = options.auth;
    this.audit = options.audit;
    this.storageRoot = options.storageRoot;
    this.now = options.now ?? Date.now;
  }

  list(): ManagedUser[] {
    return this.users.list().map((user) => {
      const quota = this.quotas.get(user.id);
      return {
        ...toPublicUser(user),
        quotaBytes: quota === null ? 0 : quota.quotaBytes,
        usedBytes: quota?.usedBytes ?? 0,
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil,
      };
    });
  }

  async createAdmin(input: { username: string; password: string }): Promise<ManagedUser> {
    if (this.users.findAdmin() !== null) {
      throw new AdminError(ADMIN_ERROR.ADMIN_EXISTS, '管理员已存在，无法重复初始化');
    }

    const user = await this.createAccount({
      username: input.username,
      password: input.password,
      role: 'admin',
      quotaBytes: null,
      actorType: 'system',
      auditAction: 'user.create',
    });

    return user;
  }

  async createUser(
    input: { username: string; password: string; quotaBytes: number | null },
    actor: AdminActor,
  ): Promise<ManagedUser> {
    return this.createAccount({
      username: input.username,
      password: input.password,
      role: 'user',
      quotaBytes: input.quotaBytes,
      actorType: 'admin',
      actorId: actor.id,
      auditAction: 'user.create',
    });
  }

  setQuota(userId: number, quotaBytes: number | null, actor: AdminActor): void {
    assertQuota(quotaBytes);
    const user = this.requireUser(userId);
    const before = this.quotas.get(userId)?.quotaBytes ?? 0;

    if (!this.quotas.setQuota(userId, quotaBytes, this.now())) {
      this.quotas.ensure(userId, quotaBytes, this.now());
    }

    this.audit.record({
      actorType: 'admin',
      actorId: actor.id,
      action: 'user.quota.update',
      result: 'success',
      targetType: 'user',
      targetId: String(userId),
      detail: { username: user.username, before, after: quotaBytes },
    });
  }

  async resetPassword(userId: number, newPassword: string, actor: AdminActor): Promise<void> {
    const user = this.requireUser(userId);
    await this.auth.resetPassword({
      userId,
      newPassword,
      mustChangePassword: true,
      actorType: 'admin',
      actorId: actor.id,
    });
    this.audit.record({
      actorType: 'admin',
      actorId: actor.id,
      action: 'user.password.reset',
      result: 'success',
      targetType: 'user',
      targetId: String(userId),
      detail: { username: user.username },
    });
  }

  setStatus(userId: number, status: UserStatus, actor: AdminActor): void {
    const user = this.requireUser(userId);
    if (user.role === 'admin') {
      throw new AdminError(ADMIN_ERROR.FORBIDDEN, '不能禁用管理员账户');
    }

    this.users.setStatus(userId, status, this.now());
    if (status === 'disabled') {
      this.sessions.revokeAllForUser(userId, this.now());
    }

    this.audit.record({
      actorType: 'admin',
      actorId: actor.id,
      action: 'user.status.update',
      result: 'success',
      targetType: 'user',
      targetId: String(userId),
      detail: { username: user.username, status },
    });
  }

  /** 仅清除登录失败计数与锁定时间，不修改密码、不吊销会话 */
  unlockUser(userId: number, actor: AdminActor): void {
    const user = this.requireUser(userId);
    this.users.resetFailures(userId, this.now());

    this.audit.record({
      actorType: 'admin',
      actorId: actor.id,
      action: 'user.unlock',
      result: 'success',
      targetType: 'user',
      targetId: String(userId),
      detail: {
        username: user.username,
        failedAttempts: user.failedAttempts,
        lockedUntil: user.lockedUntil,
      },
    });
  }

  async remove(userId: number, deleteFiles: boolean, actor: AdminActor): Promise<void> {
    const user = this.requireUser(userId);
    if (user.role === 'admin') {
      throw new AdminError(ADMIN_ERROR.FORBIDDEN, '不能删除管理员账户');
    }

    if (deleteFiles) {
      if (!STORAGE_KEY_PATTERN.test(user.storageKey)) {
        throw new AdminError(ADMIN_ERROR.FORBIDDEN, '用户存储目录标识非法');
      }
      const userRoot = path.join(this.storageRoot, user.storageKey);
      await rm(userRoot, { recursive: true, force: true });
    }

    this.users.delete(userId);

    this.audit.record({
      actorType: 'admin',
      actorId: actor.id,
      action: 'user.delete',
      result: 'success',
      targetType: 'user',
      targetId: String(userId),
      detail: { username: user.username, deleteFiles },
    });
  }

  private async createAccount(input: {
    username: string;
    password: string;
    role: 'admin' | 'user';
    quotaBytes: number | null;
    actorType: 'admin' | 'system';
    actorId?: number;
    auditAction: string;
  }): Promise<ManagedUser> {
    const username = normalizeUsername(input.username);
    assertPassword(input.password);
    assertQuota(input.quotaBytes);

    if (this.users.findByUsername(username) !== null) {
      throw new AdminError(ADMIN_ERROR.USERNAME_TAKEN, '用户名已被占用');
    }

    const passwordHash = await hashPassword(input.password);
    const storageKey = randomUUID();
    const now = this.now();

    const created = this.db.transaction(() => {
      const user = this.users.create({
        storageKey,
        username,
        displayName: username,
        passwordHash,
        role: input.role,
        createdAt: now,
      });
      this.quotas.ensure(user.id, input.quotaBytes, now);
      return user;
    })();

    try {
      await mkdir(path.join(this.storageRoot, storageKey), { recursive: true });
    } catch (error) {
      this.users.delete(created.id);
      throw error;
    }

    this.audit.record({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.auditAction,
      result: 'success',
      targetType: 'user',
      targetId: String(created.id),
      detail: { username, role: input.role, quotaBytes: input.quotaBytes, source: 'desktop' },
    });

    return {
      ...toPublicUser(created),
      quotaBytes: input.quotaBytes,
      usedBytes: 0,
      failedAttempts: 0,
      lockedUntil: null,
    };
  }

  private requireUser(userId: number): UserRecord {
    const user = this.users.findById(userId);
    if (user === null) {
      throw new AdminError(ADMIN_ERROR.USER_NOT_FOUND, '用户不存在');
    }
    return user;
  }
}
