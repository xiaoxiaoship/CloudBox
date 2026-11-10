import type { UserRepository } from '../db/repositories/userRepo.ts';
import type { SessionRepository } from '../db/repositories/sessionRepo.ts';
import type { AuditService } from './auditService.ts';
import type { SettingsService } from './settingsService.ts';
import {
  checkPasswordStrength,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../security/password.ts';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
} from '../security/sessionToken.ts';
import {
  toPublicUser,
  toSessionUser,
  type PublicUser,
  type SessionUser,
} from '../types/models.ts';

export const AUTH_ERROR = {
  INVALID_INPUT: 'AUTH_INVALID_INPUT',
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  SESSION_INVALID: 'AUTH_SESSION_INVALID',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
  PASSWORD_MISMATCH: 'AUTH_PASSWORD_MISMATCH',
  USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  USERNAME_TAKEN: 'AUTH_USERNAME_TAKEN',
  RENAME_LIMITED: 'AUTH_RENAME_LIMITED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR)[keyof typeof AUTH_ERROR];

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: number;
  readonly retryAfterMs?: number;

  constructor(code: AuthErrorCode, message: string, httpStatus: number, retryAfterMs?: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface AuthContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface LoginInput extends AuthContext {
  username: string;
  password: string;
}

export interface LoginResult {
  user: PublicUser;
  /** 原始会话 token，只在登录/轮换时返回一次，客户端写入 HttpOnly Cookie */
  token: string;
  expiresAt: number;
  mustChangePassword: boolean;
}

export interface ValidatedSession {
  user: SessionUser;
  tokenHash: string;
  expiresAt: number;
}

export interface ChangePasswordInput {
  userId: number;
  currentPassword: string;
  newPassword: string;
  context?: AuthContext;
}

export interface ResetPasswordInput {
  userId: number;
  newPassword: string;
  /** 管理员重置后强制用户下次登录改密，默认 true */
  mustChangePassword?: boolean;
  actorType?: 'admin' | 'system';
  actorId?: number | null;
  context?: AuthContext;
}

export interface AuthServiceDeps {
  users: UserRepository;
  sessions: SessionRepository;
  settings: SettingsService;
  audit: AuditService;
  now?: () => number;
}

/** 登录失败锁定基数：第 N 次失败锁 60s，之后每多失败一次翻倍 */
export const LOCK_BASE_MS = 60_000;
export const LOCK_MAX_MS = 60 * 60_000;
/** 会话 last_seen 的更新节流，避免每个请求都写库 */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export function computeLockDurationMs(
  failedAttempts: number,
  threshold: number,
  baseMs = LOCK_BASE_MS,
  maxMs = LOCK_MAX_MS,
): number {
  const overflow = Math.max(0, Math.trunc(failedAttempts) - Math.trunc(threshold));
  return Math.min(baseMs * 2 ** overflow, maxMs);
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AuthError(AUTH_ERROR.INVALID_INPUT, '用户名不能为空', 400);
  }
  const username = value.trim();
  if (username.length < 1 || username.length > 64) {
    throw new AuthError(AUTH_ERROR.INVALID_INPUT, '用户名长度必须在 1-64 个字符之间', 400);
  }
  if (/[\u0000-\u001f\u007f]/.test(username)) {
    throw new AuthError(AUTH_ERROR.INVALID_INPUT, '用户名包含控制字符', 400);
  }
  return username;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuthError(AUTH_ERROR.INVALID_INPUT, '密码不能为空', 400);
  }
  if (value.length > 1_024) {
    throw new AuthError(AUTH_ERROR.INVALID_INPUT, '密码长度超出限制', 400);
  }
  return value;
}

function assertPasswordPolicy(password: string): void {
  const result = checkPasswordStrength(password);
  if (!result.ok) {
    throw new AuthError(
      AUTH_ERROR.WEAK_PASSWORD,
      `密码强度不足：${result.issues.join('；')}`,
      400,
    );
  }
}

/**
 * 认证服务：登录、失败锁定、会话签发/校验/轮换/吊销、改密与重置。
 * 所有时间来自注入的 now()，便于测试锁定与过期逻辑。
 */
export class AuthService {
  private readonly users: UserRepository;
  private readonly sessions: SessionRepository;
  private readonly settings: SettingsService;
  private readonly audit: AuditService;
  private readonly now: () => number;

  constructor(deps: AuthServiceDeps) {
    this.users = deps.users;
    this.sessions = deps.sessions;
    this.settings = deps.settings;
    this.audit = deps.audit;
    this.now = deps.now ?? Date.now;
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const now = this.now();
    const username = normalizeUsername(input.username);
    const password = normalizePassword(input.password);

    const user = this.users.findByUsername(username);

    // 用户不存在时也执行一次 scrypt，避免通过响应时间枚举账号
    if (user === null) {
      await verifyPassword(password, null);
      this.recordAudit({
        actorType: 'anonymous',
        action: 'auth.login.failure',
        result: 'denied',
        targetType: 'user',
        context: input,
        detail: { username, reason: 'unknown_user' },
      });
      throw new AuthError(AUTH_ERROR.INVALID_CREDENTIALS, '用户名或密码错误', 401);
    }

    const securityEnabled = this.settings.get('security.lockEnabled');
    if (securityEnabled && user.lockedUntil !== null && user.lockedUntil > now) {
      const retryAfterMs = user.lockedUntil - now;
      this.recordAudit({
        actorType: user.role === 'admin' ? 'admin' : 'user',
        actorId: user.id,
        action: 'auth.login.locked',
        result: 'denied',
        targetType: 'user',
        targetId: String(user.id),
        context: input,
        detail: { username, retryAfterMs },
      });
      throw new AuthError(
        AUTH_ERROR.ACCOUNT_LOCKED,
        `账户已锁定，请 ${Math.ceil(retryAfterMs / 1_000)} 秒后重试`,
        423,
        retryAfterMs,
      );
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);

    if (!passwordOk) {
      const threshold = this.settings.get('security.maxLoginFailures');
      const attempts = user.failedAttempts + 1;
      const lockedUntil =
        securityEnabled && attempts >= threshold
          ? now + computeLockDurationMs(
              attempts,
              threshold,
              this.settings.get('security.lockBaseMinutes') * 60_000,
              this.settings.get('security.lockMaxMinutes') * 60_000,
            )
          : null;

      this.users.recordLoginFailure(user.id, now, lockedUntil);
      this.recordAudit({
        actorType: user.role === 'admin' ? 'admin' : 'user',
        actorId: user.id,
        action: 'auth.login.failure',
        result: 'denied',
        targetType: 'user',
        targetId: String(user.id),
        context: input,
        detail: { username, attempts, locked: lockedUntil !== null },
      });

      if (lockedUntil !== null) {
        const retryAfterMs = lockedUntil - now;
        throw new AuthError(
          AUTH_ERROR.ACCOUNT_LOCKED,
          `密码错误次数过多，账户已锁定 ${Math.ceil(retryAfterMs / 60_000)} 分钟`,
          423,
          retryAfterMs,
        );
      }

      throw new AuthError(AUTH_ERROR.INVALID_CREDENTIALS, '用户名或密码错误', 401);
    }

    // 密码正确后才检查禁用状态，避免未持有密码者枚举账号
    if (user.status === 'disabled') {
      this.recordAudit({
        actorType: user.role === 'admin' ? 'admin' : 'user',
        actorId: user.id,
        action: 'auth.login.failure',
        result: 'denied',
        targetType: 'user',
        targetId: String(user.id),
        context: input,
        detail: { username, reason: 'disabled' },
      });
      throw new AuthError(AUTH_ERROR.ACCOUNT_DISABLED, '账户已被禁用，请联系管理员', 403);
    }

    // 参数升级后透明重哈希
    if (needsRehash(user.passwordHash)) {
      const upgraded = await hashPassword(password);
      this.users.updatePasswordHash(user.id, upgraded, now);
    }

    this.users.recordLoginSuccess(user.id, now);
    const issue = this.issueSession(user.id, input, now);
    const fresh = this.users.findById(user.id) ?? user;

    this.recordAudit({
      actorType: fresh.role === 'admin' ? 'admin' : 'user',
      actorId: fresh.id,
      action: 'auth.login.success',
      result: 'success',
      targetType: 'user',
      targetId: String(fresh.id),
      context: input,
      detail: { username: fresh.username },
    });

    return {
      user: toPublicUser(fresh),
      token: issue.token,
      expiresAt: issue.expiresAt,
      mustChangePassword: fresh.mustChangePassword,
    };
  }

  /** 校验会话；无效/过期/被吊销/用户被禁用统一抛 AuthError */
  validateSession(token: string): ValidatedSession {
    const now = this.now();
    this.assertToken(token);

    const tokenHash = hashSessionToken(token);
    const session = this.sessions.findByHash(tokenHash);

    if (session === null || session.revokedAt !== null) {
      throw new AuthError(AUTH_ERROR.SESSION_INVALID, '会话无效或已退出，请重新登录', 401);
    }

    if (session.expiresAt <= now) {
      this.sessions.revoke(tokenHash, now);
      throw new AuthError(AUTH_ERROR.SESSION_EXPIRED, '登录已过期，请重新登录', 401);
    }

    const user = this.users.findById(session.userId);
    if (user === null || user.status === 'disabled') {
      this.sessions.revoke(tokenHash, now);
      throw new AuthError(AUTH_ERROR.SESSION_INVALID, '会话已失效，请重新登录', 401);
    }

    if (now - session.lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
      this.sessions.touch(tokenHash, now);
    }

    return { user: toSessionUser(user), tokenHash, expiresAt: session.expiresAt };
  }

  /** 轮换会话：旧 token 立即失效，返回新 token（登录态续期/权限变更时使用） */
  rotateSession(token: string, context: AuthContext = {}): LoginResult {
    const validated = this.validateSession(token);
    const now = this.now();

    this.sessions.revoke(validated.tokenHash, now);
    const issue = this.issueSession(validated.user.id, context, now);

    const fresh = this.users.findById(validated.user.id);
    if (fresh === null) {
      throw new AuthError(AUTH_ERROR.USER_NOT_FOUND, '用户不存在', 404);
    }

    this.recordAudit({
      actorType: fresh.role === 'admin' ? 'admin' : 'user',
      actorId: fresh.id,
      action: 'auth.session.rotated',
      result: 'success',
      targetType: 'user',
      targetId: String(fresh.id),
      context,
    });

    return {
      user: toPublicUser(fresh),
      token: issue.token,
      expiresAt: issue.expiresAt,
      mustChangePassword: fresh.mustChangePassword,
    };
  }

  /** 幂等登出：token 无效也不报错 */
  logout(token: string, context: AuthContext = {}): boolean {
    if (!isSessionTokenFormat(token)) return false;

    const now = this.now();
    const tokenHash = hashSessionToken(token);
    const session = this.sessions.findByHash(tokenHash);
    if (session === null) return false;

    const revoked = this.sessions.revoke(tokenHash, now);
    const user = this.users.findById(session.userId);

    this.recordAudit({
      actorType: user?.role === 'admin' ? 'admin' : 'user',
      actorId: session.userId,
      action: 'auth.logout',
      result: 'success',
      targetType: 'user',
      targetId: String(session.userId),
      context,
    });

    return revoked;
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    const now = this.now();
    const user = this.users.findById(input.userId);
    if (user === null) {
      throw new AuthError(AUTH_ERROR.USER_NOT_FOUND, '用户不存在', 404);
    }

    const currentPassword = normalizePassword(input.currentPassword);
    const newPassword = normalizePassword(input.newPassword);

    const currentOk = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentOk) {
      this.recordAudit({
        actorType: user.role === 'admin' ? 'admin' : 'user',
        actorId: user.id,
        action: 'auth.password.change',
        result: 'denied',
        targetType: 'user',
        targetId: String(user.id),
        context: input.context,
        detail: { reason: 'current_password_mismatch' },
      });
      throw new AuthError(AUTH_ERROR.PASSWORD_MISMATCH, '当前密码不正确', 400);
    }

    if (currentPassword === newPassword) {
      throw new AuthError(AUTH_ERROR.INVALID_INPUT, '新密码不能与当前密码相同', 400);
    }
    assertPasswordPolicy(newPassword);

    const passwordHash = await hashPassword(newPassword);
    this.users.updatePasswordHash(user.id, passwordHash, now);
    this.users.resetFailures(user.id, now);
    this.sessions.revokeAllForUser(user.id, now);

    this.recordAudit({
      actorType: user.role === 'admin' ? 'admin' : 'user',
      actorId: user.id,
      action: 'auth.password.change',
      result: 'success',
      targetType: 'user',
      targetId: String(user.id),
      context: input.context,
    });
  }

  /** 管理员重置 / 本机 CLI 重置；会解锁账户并强制下线所有设备 */
  async rename(user: SessionUser, username: string, context: AuthContext = {}): Promise<PublicUser> {
    const next = normalizeUsername(username);
    const current = this.users.findById(user.id);
    if (current === null) {
      throw new AuthError(AUTH_ERROR.USER_NOT_FOUND, '用户不存在', 404);
    }
    if (next === current.username) return toPublicUser(current);

    const existing = this.users.findByUsername(next);
    if (existing !== null && existing.id !== current.id) {
      throw new AuthError(AUTH_ERROR.USERNAME_TAKEN, '用户名已被占用', 409);
    }

    if (current.role !== 'admin' && this.settings.get('security.renameEnabled')) {
      const windowMs = this.settings.get('security.renameWindowHours') * 3_600_000;
      const since = this.now() - windowMs;
      const recent = this.audit
        .list({ limit: 500 })
        .filter((entry) => entry.action === 'user.rename' && entry.actorId === current.id && entry.ts >= since);
      if (recent.length >= this.settings.get('security.renameLimit')) {
        const retryAfterMs = Math.max(1_000, (recent.at(-1)?.ts ?? this.now()) + windowMs - this.now());
        this.recordAudit({
          actorType: 'user',
          actorId: current.id,
          action: 'user.rename',
          result: 'denied',
          targetType: 'user',
          targetId: String(current.id),
          context,
          detail: { reason: 'rate_limited', next },
        });
        throw new AuthError(
          AUTH_ERROR.RENAME_LIMITED,
          '改名次数已达上限，请稍后再试',
          429,
          retryAfterMs,
        );
      }
    }

    if (!this.users.updateUsername(current.id, next, this.now())) {
      throw new AuthError(AUTH_ERROR.USERNAME_TAKEN, '用户名已被占用', 409);
    }
    this.recordAudit({
      actorType: current.role === 'admin' ? 'admin' : 'user',
      actorId: current.id,
      action: 'user.rename',
      result: 'success',
      targetType: 'user',
      targetId: String(current.id),
      context,
      detail: { before: current.username, after: next },
    });
    return toPublicUser(this.users.findById(current.id)!);
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const now = this.now();
    const user = this.users.findById(input.userId);
    if (user === null) {
      throw new AuthError(AUTH_ERROR.USER_NOT_FOUND, '用户不存在', 404);
    }

    const newPassword = normalizePassword(input.newPassword);
    assertPasswordPolicy(newPassword);

    const passwordHash = await hashPassword(newPassword);
    this.users.updatePasswordHash(user.id, passwordHash, now);
    this.users.resetFailures(user.id, now);
    this.users.setMustChangePassword(user.id, input.mustChangePassword ?? true, now);
    this.sessions.revokeAllForUser(user.id, now);

    this.recordAudit({
      actorType: input.actorType ?? 'admin',
      actorId: input.actorId ?? null,
      action: 'auth.password.reset',
      result: 'success',
      targetType: 'user',
      targetId: String(user.id),
      context: input.context,
      detail: { username: user.username, mustChangePassword: input.mustChangePassword ?? true },
    });
  }

  revokeAllSessions(userId: number, context: AuthContext = {}): number {
    const now = this.now();
    const changed = this.sessions.revokeAllForUser(userId, now);
    this.recordAudit({
      actorType: 'admin',
      actorId: null,
      action: 'auth.session.revoke_all',
      result: 'success',
      targetType: 'user',
      targetId: String(userId),
      context,
      detail: { revoked: changed },
    });
    return changed;
  }

  private issueSession(
    userId: number,
    context: AuthContext,
    now: number,
  ): { token: string; expiresAt: number } {
    const token = generateSessionToken();
    const ttlMs = this.settings.get('security.sessionTtlHours') * 3_600_000;
    const expiresAt = now + ttlMs;

    this.sessions.create({
      idHash: hashSessionToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return { token, expiresAt };
  }

  private assertToken(token: unknown): asserts token is string {
    if (!isSessionTokenFormat(token)) {
      throw new AuthError(AUTH_ERROR.SESSION_INVALID, '会话无效，请重新登录', 401);
    }
  }

  private recordAudit(event: {
    actorType: 'admin' | 'user' | 'system' | 'anonymous';
    actorId?: number | null;
    action: string;
    result: 'success' | 'denied' | 'error';
    targetType?: string | null;
    targetId?: string | null;
    context?: AuthContext;
    detail?: unknown;
  }): void {
    this.audit.record({
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      action: event.action,
      result: event.result,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      ip: event.context?.ip ?? null,
      userAgent: event.context?.userAgent ?? null,
      requestId: event.context?.requestId ?? null,
      detail: event.detail,
    });
  }
}
