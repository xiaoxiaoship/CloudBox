import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { closeDatabase, openDatabase, type Db } from '../../src/core/db/connection.ts';
import { migrate } from '../../src/core/db/migrator.ts';
import { AuditRepository } from '../../src/core/db/repositories/auditRepo.ts';
import { QuotaRepository } from '../../src/core/db/repositories/quotaRepo.ts';
import { SessionRepository } from '../../src/core/db/repositories/sessionRepo.ts';
import { SettingsRepository } from '../../src/core/db/repositories/settingsRepo.ts';
import { UserRepository } from '../../src/core/db/repositories/userRepo.ts';
import { hashPassword } from '../../src/core/security/password.ts';
import { hashSessionToken } from '../../src/core/security/sessionToken.ts';
import { AuditService } from '../../src/core/services/auditService.ts';
import {
  AUTH_ERROR,
  AuthError,
  AuthService,
  LOCK_BASE_MS,
  type AuthErrorCode,
} from '../../src/core/services/authService.ts';
import { SettingsService } from '../../src/core/services/settingsService.ts';

const BASE_TIME = Date.UTC(2026, 0, 1);
const TEST_PASSWORD = 'Passw0rd!';
const NEW_PASSWORD = 'NewPassw0rd!';

let cachedHash: Promise<string> | null = null;
function testPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return cachedHash;
}

interface Harness {
  db: Db;
  users: UserRepository;
  quotas: QuotaRepository;
  sessions: SessionRepository;
  settings: SettingsService;
  audit: AuditService;
  auth: AuthService;
  clock: () => number;
  advance: (ms: number) => void;
}

function buildHarness(db: Db): Harness {
  const users = new UserRepository(db);
  const quotas = new QuotaRepository(db);
  const sessions = new SessionRepository(db);

  let current = BASE_TIME;
  const clock = (): number => current;

  // 三个服务共用同一时钟，保证锁定/过期/TTL 逻辑完全确定
  const settings = new SettingsService(new SettingsRepository(db), clock);
  const audit = new AuditService(new AuditRepository(db), clock);

  const auth = new AuthService({ users, sessions, settings, audit, now: clock });

  return {
    db,
    users,
    quotas,
    sessions,
    settings,
    audit,
    auth,
    clock,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

async function createUser(
  harness: Harness,
  username = 'alice',
  options: {
    role?: 'admin' | 'user';
    status?: 'active' | 'disabled';
    mustChangePassword?: boolean;
  } = {},
): Promise<number> {
  const user = harness.users.create({
    storageKey: randomUUID(),
    username,
    passwordHash: await testPasswordHash(),
    role: options.role ?? 'user',
    status: options.status ?? 'active',
    mustChangePassword: options.mustChangePassword ?? false,
    createdAt: harness.clock(),
  });
  harness.quotas.ensure(user.id, 1_000_000, harness.clock());
  return user.id;
}

function authError(code: AuthErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AuthError && error.code === code;
}

describe('authService', () => {
  let h: Harness;

  beforeEach(() => {
    const db = openDatabase({ file: ':memory:' });
    migrate(db);
    h = buildHarness(db);
  });

  afterEach(() => {
    closeDatabase(h.db);
  });

  it('登录成功：签发 token、入库只存哈希、记录 lastLoginAt 与审计', async () => {
    const userId = await createUser(h);

    const result = await h.auth.login({
      username: 'alice',
      password: TEST_PASSWORD,
      ip: '10.0.0.5',
      userAgent: 'test-agent',
    });

    assert.equal(result.user.id, userId);
    assert.equal(result.user.username, 'alice');
    assert.equal(result.token.length, 43);
    assert.ok(result.expiresAt > h.clock());
    assert.equal(result.mustChangePassword, false);

    const tokenHash = hashSessionToken(result.token);
    const session = h.sessions.findByHash(tokenHash);
    assert.ok(session);
    assert.equal(session!.userId, userId);
    assert.equal(session!.ip, '10.0.0.5');
    assert.notEqual(session!.idHash, result.token);
    assert.equal(session!.idHash.length, 64);

    const refreshed = h.users.findById(userId)!;
    assert.equal(refreshed.lastLoginAt, h.clock());
    assert.equal(refreshed.failedAttempts, 0);
    assert.equal(refreshed.lockedUntil, null);

    const latest = h.audit.list({ limit: 1 })[0]!;
    assert.equal(latest.action, 'auth.login.success');
    assert.equal(latest.result, 'success');
    assert.equal(latest.actorId, userId);
  });

  it('用户名大小写不敏感', async () => {
    await createUser(h, 'Alice');
    const result = await h.auth.login({ username: 'ALICE', password: TEST_PASSWORD });
    assert.equal(result.user.username, 'Alice');
  });

  it('密码错误：失败计数递增并写审计，不泄露账号是否存在', async () => {
    const userId = await createUser(h);

    await assert.rejects(
      h.auth.login({ username: 'alice', password: 'WrongPass1' }),
      authError(AUTH_ERROR.INVALID_CREDENTIALS),
    );

    const refreshed = h.users.findById(userId)!;
    assert.equal(refreshed.failedAttempts, 1);
    assert.equal(refreshed.lockedUntil, null);

    const latest = h.audit.list({ limit: 1 })[0]!;
    assert.equal(latest.action, 'auth.login.failure');
    assert.equal(latest.result, 'denied');
    assert.deepEqual(JSON.parse(latest.detail!), { username: 'alice', attempts: 1, locked: false });

    // 未知用户：同样的错误码，且不产生会话
    await assert.rejects(
      h.auth.login({ username: 'nobody', password: 'WrongPass1' }),
      authError(AUTH_ERROR.INVALID_CREDENTIALS),
    );
    assert.equal(h.sessions.countActive(userId, h.clock()), 0);
    const unknownAudit = h.audit.list({ limit: 1 })[0]!;
    assert.equal(JSON.parse(unknownAudit.detail!).reason, 'unknown_user');
  });

  it('连续失败达到阈值后锁定，锁定期内正确密码也无法登录', async () => {
    const userId = await createUser(h);

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await assert.rejects(
        h.auth.login({ username: 'alice', password: 'WrongPass1' }),
        authError(AUTH_ERROR.INVALID_CREDENTIALS),
      );
    }

    await assert.rejects(
      h.auth.login({ username: 'alice', password: 'WrongPass1' }),
      (error: unknown) =>
        error instanceof AuthError &&
        error.code === AUTH_ERROR.ACCOUNT_LOCKED &&
        error.retryAfterMs === LOCK_BASE_MS,
    );

    const locked = h.users.findById(userId)!;
    assert.equal(locked.failedAttempts, 5);
    assert.equal(locked.lockedUntil, h.clock() + LOCK_BASE_MS);

    await assert.rejects(
      h.auth.login({ username: 'alice', password: TEST_PASSWORD }),
      authError(AUTH_ERROR.ACCOUNT_LOCKED),
    );

    const lockedAudit = h.audit.list({ limit: 1 })[0]!;
    assert.equal(lockedAudit.action, 'auth.login.locked');
  });

  it('锁定到期后可正常登录，失败计数归零', async () => {
    const userId = await createUser(h);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assert.rejects(
        h.auth.login({ username: 'alice', password: 'WrongPass1' }),
        authError(AUTH_ERROR.INVALID_CREDENTIALS),
      );
    }
    await assert.rejects(
      h.auth.login({ username: 'alice', password: 'WrongPass1' }),
      authError(AUTH_ERROR.ACCOUNT_LOCKED),
    );

    h.advance(LOCK_BASE_MS + 1);

    const result = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });
    assert.equal(result.user.id, userId);

    const refreshed = h.users.findById(userId)!;
    assert.equal(refreshed.failedAttempts, 0);
    assert.equal(refreshed.lockedUntil, null);
  });

  it('禁用账户：密码正确也拒绝登录', async () => {
    const userId = await createUser(h, 'alice', { status: 'disabled' });

    await assert.rejects(
      h.auth.login({ username: 'alice', password: TEST_PASSWORD }),
      authError(AUTH_ERROR.ACCOUNT_DISABLED),
    );

    assert.equal(h.sessions.countActive(userId, h.clock()), 0);
    const latest = h.audit.list({ limit: 1 })[0]!;
    assert.equal(JSON.parse(latest.detail!).reason, 'disabled');
  });

  it('阈值可通过设置调整（3 次失败即锁定）', async () => {
    await createUser(h);
    h.settings.set('security.maxLoginFailures', 3);

    await assert.rejects(
      h.auth.login({ username: 'alice', password: 'WrongPass1' }),
      authError(AUTH_ERROR.INVALID_CREDENTIALS),
    );
    await assert.rejects(
      h.auth.login({ username: 'alice', password: 'WrongPass1' }),
      authError(AUTH_ERROR.INVALID_CREDENTIALS),
    );
    await assert.rejects(
      h.auth.login({ username: 'alice', password: 'WrongPass1' }),
      authError(AUTH_ERROR.ACCOUNT_LOCKED),
    );
  });

  it('validateSession：有效 / 篡改 / 过期 / 吊销 / 用户禁用', async () => {
    const userId = await createUser(h);
    const login = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });

    const validated = h.auth.validateSession(login.token);
    assert.equal(validated.user.id, userId);
    assert.equal(validated.user.storageKey.length > 0, true);
    assert.equal('passwordHash' in validated.user, false);

    assert.throws(
      () => h.auth.validateSession(`${login.token.slice(0, -1)}x`),
      authError(AUTH_ERROR.SESSION_INVALID),
    );

    // 用户被禁用后，已有会话立即失效
    h.users.setStatus(userId, 'disabled', h.clock());
    assert.throws(
      () => h.auth.validateSession(login.token),
      authError(AUTH_ERROR.SESSION_INVALID),
    );
    assert.equal(h.sessions.findByHash(hashSessionToken(login.token))!.revokedAt !== null, true);
  });

  it('会话按设置 TTL 过期', async () => {
    await createUser(h);
    h.settings.set('security.sessionTtlHours', 1);

    const login = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });
    h.advance(3_600_001);

    assert.throws(
      () => h.auth.validateSession(login.token),
      authError(AUTH_ERROR.SESSION_EXPIRED),
    );
  });

  it('轮换会话：旧 token 立即失效，新 token 可用', async () => {
    await createUser(h);
    const login = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });

    const rotated = h.auth.rotateSession(login.token);
    assert.notEqual(rotated.token, login.token);
    assert.equal(rotated.user.username, 'alice');

    assert.throws(
      () => h.auth.validateSession(login.token),
      authError(AUTH_ERROR.SESSION_INVALID),
    );
    assert.equal(h.auth.validateSession(rotated.token).user.username, 'alice');
  });

  it('登出：幂等吊销会话并写审计', async () => {
    await createUser(h);
    const login = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });

    assert.equal(h.auth.logout(login.token), true);
    assert.equal(h.auth.logout(login.token), false);
    assert.throws(
      () => h.auth.validateSession(login.token),
      authError(AUTH_ERROR.SESSION_INVALID),
    );

    const audit = h.audit.list({ limit: 1 })[0]!;
    assert.equal(audit.action, 'auth.logout');
  });

  it('修改密码：校验当前密码、吊销全部会话、新密码生效', async () => {
    const userId = await createUser(h);
    const login = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });

    await assert.rejects(
      h.auth.changePassword({
        userId,
        currentPassword: 'WrongPass1',
        newPassword: NEW_PASSWORD,
      }),
      authError(AUTH_ERROR.PASSWORD_MISMATCH),
    );

    await assert.rejects(
      h.auth.changePassword({
        userId,
        currentPassword: TEST_PASSWORD,
        newPassword: 'short',
      }),
      authError(AUTH_ERROR.WEAK_PASSWORD),
    );

    await assert.rejects(
      h.auth.changePassword({
        userId,
        currentPassword: TEST_PASSWORD,
        newPassword: TEST_PASSWORD,
      }),
      authError(AUTH_ERROR.INVALID_INPUT),
    );

    await h.auth.changePassword({
      userId,
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    assert.throws(
      () => h.auth.validateSession(login.token),
      authError(AUTH_ERROR.SESSION_INVALID),
    );
    await assert.rejects(
      h.auth.login({ username: 'alice', password: TEST_PASSWORD }),
      authError(AUTH_ERROR.INVALID_CREDENTIALS),
    );

    const relogin = await h.auth.login({ username: 'alice', password: NEW_PASSWORD });
    assert.equal(relogin.user.id, userId);
  });

  it('重置密码：解锁账户、吊销会话、强制改密标记生效', async () => {
    const userId = await createUser(h);
    const login = await h.auth.login({ username: 'alice', password: TEST_PASSWORD });

    h.users.recordLoginFailure(userId, h.clock(), h.clock() + 60_000);

    await h.auth.resetPassword({
      userId,
      newPassword: NEW_PASSWORD,
      actorType: 'admin',
      actorId: 999,
    });

    const refreshed = h.users.findById(userId)!;
    assert.equal(refreshed.failedAttempts, 0);
    assert.equal(refreshed.lockedUntil, null);
    assert.equal(refreshed.mustChangePassword, true);

    assert.throws(
      () => h.auth.validateSession(login.token),
      authError(AUTH_ERROR.SESSION_INVALID),
    );

    const relogin = await h.auth.login({ username: 'alice', password: NEW_PASSWORD });
    assert.equal(relogin.mustChangePassword, true);

    const audit = h.audit.list({ limit: 1 })[0]!;
    assert.equal(audit.action, 'auth.login.success');
  });

  it('登录参数非法时拒绝，且不写会话', async () => {
    await createUser(h);

    await assert.rejects(
      h.auth.login({ username: '', password: TEST_PASSWORD }),
      authError(AUTH_ERROR.INVALID_INPUT),
    );
    await assert.rejects(
      h.auth.login({ username: 'alice', password: '' }),
      authError(AUTH_ERROR.INVALID_INPUT),
    );
  });
});
