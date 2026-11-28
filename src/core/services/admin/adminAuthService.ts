import type { AuditService } from '../auditService.ts';
import type { AdminSessionRepository } from '../../db/repositories/adminSessionRepo.ts';
import type { UserRepository } from '../../db/repositories/userRepo.ts';
import type { SettingsService } from '../settingsService.ts';
import type { AdminUserService } from './adminUserService.ts';
import { checkPasswordStrength, hashPassword, needsRehash, verifyPassword } from '../../security/password.ts';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
} from '../../security/sessionToken.ts';
import { toPublicUser, type PublicUser, type UserRecord } from '../../types/models.ts';
import { AdminError, ADMIN_ERROR } from './adminUserService.ts';
import { ADMIN_SESSION_TTL_MS } from '../../../shared/admin.ts';

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

export interface AdminSessionView {
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
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

  listSessions(userId: number, currentHash: string | null): Array<{
    current: boolean; ip: string | null; userAgent: string | null;
    createdAt: number; lastSeenAt: number; expiresAt: number;
  }> {
    return this.sessions.listForUser(userId, this.now()).map((session) => ({
      current: currentHash !== null && session.idHash === currentHash,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    }));
  }

  revokeAllSessions(userId: number): number {
    return this.sessions.revokeAllForUser(userId, this.now());
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.users.findById(userId);
    if (user === null || user.role !== 'admin') {
      throw new AdminAuthError(ADMIN_AUTH_ERROR.FORBIDDEN, '管理员账户不存在', 403);
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AdminAuthError(ADMIN_AUTH_ERROR.INVALID_CREDENTIALS, '当前密码错误', 400);
    }
    const strength = checkPasswordStrength(newPassword);
    if (!strength.ok) {
      throw new AdminAuthError('ADMIN_WEAK_PASSWORD', `密码强度不足：${strength.issues.join('；')}`, 400);
    }
    this.users.updatePasswordHash(user.id, await hashPassword(newPassword), this.now());
    this.sessions.revokeAllForUser(user.id, this.now());
    this.audit.record({
      actorType: 'admin',
      actorId: user.id,
      action: 'admin.password.change',
      result: 'success',
      targetType: 'user',
      targetId: String(user.id),
    });
  }

  private issueSession(user: UserRecord, ctx: AdminAuthContext): AdminLoginResult {
    const now = this.now();
    const token = generateSessionToken();
    const ttlHours = this.settings.getLowLevel().adminSessionTtlHours;
    const expiresAt = now + (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 60 * 60_000 : ADMIN_SESSION_TTL_MS);
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
