import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeLockDurationMs,
  LOCK_BASE_MS,
  LOCK_MAX_MS,
} from '../../src/core/services/authService.ts';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenFormat,
} from '../../src/core/security/sessionToken.ts';
import { toPublicUser, toSessionUser, type UserRecord } from '../../src/core/types/models.ts';

describe('computeLockDurationMs', () => {
  it('首次达到阈值锁定 1 分钟', () => {
    assert.equal(computeLockDurationMs(5, 5), LOCK_BASE_MS);
    assert.equal(LOCK_BASE_MS, 60_000);
  });

  it('继续失败按 2 的幂递增', () => {
    assert.equal(computeLockDurationMs(6, 5), 120_000);
    assert.equal(computeLockDurationMs(7, 5), 240_000);
    assert.equal(computeLockDurationMs(8, 5), 480_000);
  });

  it('封顶 1 小时，且不会出现负值', () => {
    assert.equal(computeLockDurationMs(30, 5), LOCK_MAX_MS);
    assert.equal(computeLockDurationMs(3, 5), LOCK_BASE_MS);
  });
});

describe('session token', () => {
  it('生成 43 字符 base64url，且每次不同', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();

    assert.equal(a.length, 43);
    assert.notEqual(a, b);
    assert.equal(isSessionTokenFormat(a), true);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });

  it('哈希为 64 位十六进制且不可逆推', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, token);
    assert.equal(hashSessionToken(token), hash);
  });

  it('拒绝格式非法的 token', () => {
    for (const value of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), '../etc/passwd', 'a b']) {
      assert.equal(isSessionTokenFormat(value), false);
    }
    assert.equal(isSessionTokenFormat(undefined), false);
    assert.equal(isSessionTokenFormat(123), false);
  });
});

describe('user view mappers', () => {
  const user: UserRecord = {
    id: 1,
    storageKey: 'storage-key',
    username: 'alice',
    displayName: 'Alice',
    passwordHash: 'scrypt$secret',
    role: 'user',
    status: 'active',
    mustChangePassword: false,
    failedAttempts: 2,
    lockedUntil: null,
    lastLoginAt: 123,
    avatarDataUrl: null,
    createdAt: 100,
    updatedAt: 200,
  };

  it('toPublicUser 不包含密码哈希与内部字段', () => {
    const publicUser = toPublicUser(user);

    assert.equal('passwordHash' in publicUser, false);
    assert.equal('failedAttempts' in publicUser, false);
    assert.equal('lockedUntil' in publicUser, false);
    assert.equal(publicUser.username, 'alice');
  });

  it('toSessionUser 去掉密码哈希但保留 storageKey', () => {
    const sessionUser = toSessionUser(user);

    assert.equal('passwordHash' in sessionUser, false);
    assert.equal(sessionUser.storageKey, 'storage-key');
    assert.equal(sessionUser.failedAttempts, 2);
  });
});
