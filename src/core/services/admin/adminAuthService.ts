import type { AuditService } from '../auditService.ts';
import type { AdminSessionRepository } from '../../db/repositories/adminSessionRepo.ts';
import type { UserRepository } from '../../db/repositories/userRepo.ts';
import type { SettingsService } from '../settingsService.ts';
import type { AdminUserService } from './adminUserService.ts';
import { hashPassword, needsRehash, verifyPassword } from '../../security/password.ts';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
} from '../../security/sessionToken.ts';
import { toPublicUser, type PublicUser, type UserRecord } from '../../types/models.ts';
import { AdminError, ADMIN_ERROR } from './adminUserService.ts';

export const ADMIN_AUTH_ERROR = {
  INVALID_CREDENTIALS: 'ADMIN_INVALID_CREDENTIALS',
  FORBIDDEN: 'ADMIN_FORBIDDEN',
  DISABLED: 'ADMIN_DISABLED',
  SESSION_INVALID: 'ADMIN_SESSION_INVALID',
  ADMIN_EXISTS: 'ADMIN_EXISTS',
} as const;

export class AdminAuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 401) {
    super(message);
    this.name = 'AdminAuthError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface AdminAuthContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AdminLoginResult {
  user: PublicUser;
  token: string;
  expiresAt: number;
}

export interface ValidatedAdminSession {
  user: PublicUser;
  tokenHash: string;
  expiresAt: number;
}

export class AdminAuthService {
  private readonly users: UserRepository;
  private readonly sessions: AdminSessionRepository;
  private readonly adminUsers: AdminUserService;
  private readonly settings: SettingsService;
  private readonly audit: AuditService;
  private readonly now: () => number;

  constructor(options: {
    users: UserRepository;
    sessions: AdminSessionRepository;
    adminUsers: AdminUserService;
    settings: SettingsService;
    audit: AuditService;
    now?: () => number;
  }) {
    this.users = options.users;
    this.sessions = options.sessions;
    this.adminUsers = options.adminUsers;
    this.settings = options.settings;
    this.audit = options.audit;
    this.now = options.now ?? Date.now;
  }

  needsSetup(): boolean {
    return this.users.findAdmin() === null;
  }

  async login(usernameInput: string, password: string, ctx: AdminAuthContext): Promise<AdminLoginResult> {
    const username = usernameInput.trim();
    if (!username || !password) {
      throw new AdminAuthError(ADMIN_AUTH_ERROR.INVALID_CREDENTIALS, '请输入管理员用户名和密码', 400);
    }

    const user = this.users.findByUsername(username);
    if (user === null || user.role !== 'admin') {
      this.auditFailure(username, ctx, 'not_found');
      throw new AdminAuthError(ADMIN_AUTH_ERROR.INVALID_CREDENTIALS, '用户名或密码错误');
    }
    if (user.status !== 'active') {
      this.auditFailure(username, ctx, 'disabled');
      throw new AdminAuthError(ADMIN_AUTH_ERROR.DISABLED, '管理员账户已被禁用', 403);
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      this.auditFailure(username, ctx, 'bad_password');
      throw new AdminAuthError(ADMIN_AUTH_ERROR.INVALID_CREDENTIALS, '用户名或密码错误');
    }

    if (needsRehash(user.passwordHash)) {
      this.users.updatePasswordHash(user.id, await hashPassword(password), this.now());
    }

    return this.issueSession(user, ctx);
  }

  async setup(
    username: string,
    password: string,
    ctx: AdminAuthContext,
  ): Promise<AdminLoginResult> {
    if (!this.needsSetup()) {
      throw new AdminAuthError(ADMIN_AUTH_ERROR.ADMIN_EXISTS, '管理员已存在', 409);
    }
    const managed = await this.adminUsers.createAdmin({ username, password });
    const user = this.users.findById(managed.id);
    if (user === null) throw new AdminAuthError(ADMIN_AUTH_ERROR.FORBIDDEN, '创建管理员失败', 500);
    this.audit.record({
      actorType: 'admin',
      actorId: user.id,
      action: 'admin.setup',
      result: 'success',
      targetType: 'user',
      targetId: String(user.id),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    });
    return this.issueSession(user, ctx);
  }

  validate(token: string | null, ctx: AdminAuthContext = {}): ValidatedAdminSession | null {
    if (token === null || !isSessionTokenFormat(token)) return null;
    const tokenHash = hashSessionToken(token);
    const session = this.sessions.get(tokenHash);
    const now = this.now();
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= now
    ) {
      return null;
    }

    const user = this.users.findById(session.userId);
    if (user === null || user.role !== 'admin' || user.status !== 'active') {
      this.sessions.revoke(tokenHash, now);
      return null;
    }

    if (now - session.lastSeenAt >= 60_000) this.sessions.touch(tokenHash, now);
    return { user: toPublicUser(user), tokenHash, expiresAt: session.expiresAt };
  }

  logout(token: string | null): void {
    if (token === null || !isSessionTokenFormat(token)) return;
    this.sessions.revoke(hashSessionToken(token), this.now());
  }

  deleteExpired(): number {
    return this.sessions.deleteExpired(this.now());
  }

  private issueSession(user: UserRecord, ctx: AdminAuthContext): AdminLoginResult {
    const now = this.now();
    const token = generateSessionToken();
    const expiresAt = now + this.settings.get('security.sessionTtlHours') * 3_600_000;
    const tokenHash = hashSessionToken(token);
    this.sessions.create({
      idHash: tokenHash,
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    this.audit.record({
      actorType: 'admin',
      actorId: user.id,
      action: 'admin.login.success',
      result: 'success',
      targetType: 'user',
      targetId: String(user.id),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    });
    return { user: toPublicUser(user), token, expiresAt };
  }

  private auditFailure(username: string, ctx: AdminAuthContext, reason: string): void {
    this.audit.record({
      actorType: 'admin',
      action: 'admin.login.failure',
      result: 'denied',
      targetType: 'admin',
      targetPath: '/api/admin/auth/login',
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail: { username, reason },
    });
  }
}

export function isAdminAuthError(error: unknown): error is AdminAuthError {
  return error instanceof AdminAuthError;
}

export { ADMIN_ERROR, AdminError };
