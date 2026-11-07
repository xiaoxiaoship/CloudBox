/** 领域模型：与数据库行解耦，服务层只消费这些结构 */

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export interface UserRecord {
  id: number;
  storageKey: string;
  username: string;
  displayName: string;
  /** 仅供认证服务内部使用，禁止出现在任何对外响应中 */
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  avatarDataUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 不含密码哈希、失败计数等内部字段，可安全回传 UI */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  avatarDataUrl: string | null;
  createdAt: number;
}

/** 会话校验后可用的用户视图：去掉密码哈希，但保留 storageKey 供文件服务使用 */
export type SessionUser = Omit<UserRecord, 'passwordHash'>;

interface PublicUserSource {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  avatarDataUrl?: string | null;
}

export function toPublicUser(user: PublicUserSource): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    avatarDataUrl: user.avatarDataUrl ?? null,
    createdAt: user.createdAt,
  };
}

export function toSessionUser(user: UserRecord): SessionUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export interface QuotaRecord {
  userId: number;
  /** null 表示不限量 */
  quotaBytes: number | null;
  usedBytes: number;
  updatedAt: number;
}

export interface SessionRecord {
  idHash: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
  revokedAt: number | null;
}

export type AuditActorType = 'admin' | 'user' | 'system' | 'anonymous';
export type AuditResult = 'success' | 'denied' | 'error';

export interface NewAuditLog {
  ts: number;
  actorType: AuditActorType;
  actorId: number | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetPath: string | null;
  result: AuditResult;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  detail: string | null;
}

export interface AuditLogRecord extends NewAuditLog {
  id: number;
}
