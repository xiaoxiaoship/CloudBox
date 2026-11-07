import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/connection.ts';
import type { QuotaRepository } from '../db/repositories/quotaRepo.ts';
import type { UserRepository } from '../db/repositories/userRepo.ts';
import { hashPassword } from '../security/password.ts';
import { toPublicUser, type PublicUser, type UserRecord } from '../types/models.ts';
import type { AuditService } from './auditService.ts';
import type { EventBus } from './eventBus.ts';
import type { RequestContext } from './fileService.ts';
import type { SettingsService } from './settingsService.ts';

export const REGISTRATION_ERROR = {
  DISABLED: 'REGISTRATION_DISABLED',
  INVALID_USERNAME: 'REGISTRATION_INVALID_USERNAME',
  WEAK_PASSWORD: 'REGISTRATION_WEAK_PASSWORD',
  USERNAME_TAKEN: 'REGISTRATION_USERNAME_TAKEN',
} as const;

export type RegistrationErrorCode =
  (typeof REGISTRATION_ERROR)[keyof typeof REGISTRATION_ERROR];

export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  readonly httpStatus: number;

  constructor(code: RegistrationErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const DEFAULT_REGISTRATION_QUOTA_BYTES = 5 * 1024 ** 3;

const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;

/**
 * 网页公开注册：
 *  - 设置关闭时直接 403
 *  - 用户名 3-20 位字母数字；密码至少 8 位
 *  - 复用 scrypt / UserRepository / QuotaRepository / AuditService
 *  - 注册成功立即写库，无需重启服务即可登录
 */
export class RegistrationService {
  private readonly db: Db;
  private readonly users: UserRepository;
  private readonly quotas: QuotaRepository;
  private readonly settings: SettingsService;
  private readonly audit: AuditService;
  private readonly events: EventBus | null;
  private readonly storageRoot: string;
  private readonly now: () => number;

  constructor(options: {
    db: Db;
    users: UserRepository;
    quotas: QuotaRepository;
    settings: SettingsService;
    audit: AuditService;
    storageRoot: string;
    events?: EventBus;
    now?: () => number;
  }) {
    this.db = options.db;
    this.users = options.users;
    this.quotas = options.quotas;
    this.settings = options.settings;
    this.audit = options.audit;
    this.events = options.events ?? null;
    this.storageRoot = options.storageRoot;
    this.now = options.now ?? Date.now;
  }

  async register(
    input: { username: string; password: string },
    ctx: RequestContext,
  ): Promise<PublicUser> {
    if (!this.settings.get('allow_public_registration')) {
      throw new RegistrationError(
        REGISTRATION_ERROR.DISABLED,
        '管理员尚未开启网页自助注册',
        403,
      );
    }

    const username = input.username.trim();
    if (!USERNAME_PATTERN.test(username)) {
      throw new RegistrationError(
        REGISTRATION_ERROR.INVALID_USERNAME,
        '用户名必须为 3-20 位字母或数字',
        400,
      );
    }
    if (input.password.length < 8 || input.password.length > 128) {
      throw new RegistrationError(
        REGISTRATION_ERROR.WEAK_PASSWORD,
        '密码长度必须为 8-128 位',
        400,
      );
    }
    if (this.users.findByUsername(username) !== null) {
      throw new RegistrationError(
        REGISTRATION_ERROR.USERNAME_TAKEN,
        '用户名已被使用',
        409,
      );
    }

    const passwordHash = await hashPassword(input.password);
    const storageKey = randomUUID();
    const createdAt = this.now();

    let user: UserRecord;
    try {
      user = this.db.transaction(() => {
        const created = this.users.create({
          storageKey,
          username,
          displayName: username,
          passwordHash,
          role: 'user',
          status: 'active',
          createdAt,
        });
        this.quotas.ensure(created.id, DEFAULT_REGISTRATION_QUOTA_BYTES, createdAt);
        return created;
      })();
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) {
        throw new RegistrationError(
          REGISTRATION_ERROR.USERNAME_TAKEN,
          '用户名已被使用',
          409,
        );
      }
      throw error;
    }

    const userDir = path.join(this.storageRoot, storageKey);
    try {
      await mkdir(userDir, { recursive: true });
    } catch (error) {
      // 目录创建失败时回滚账户，避免留下不可用的垃圾账号
      this.db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      await rm(userDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    this.audit.record({
      actorType: 'anonymous',
      actorId: null,
      action: 'user.register',
      result: 'success',
      targetType: 'user',
      targetId: String(user.id),
      targetPath: username,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail: {
        username,
        role: 'user',
        quotaBytes: DEFAULT_REGISTRATION_QUOTA_BYTES,
      },
    });

    this.events?.emit('user.registered', {
      userId: user.id,
      username,
      role: 'user',
    });

    return toPublicUser(user);
  }
}
