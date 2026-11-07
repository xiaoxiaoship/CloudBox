import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AdminUserService } from '../../src/core/services/adminUserService.ts';
import { createTestServer, TestClient, type TestServer } from '../helpers/testServer.ts';

describe('admin unlock user', () => {
  let t: TestServer;
  let adminUsers: AdminUserService;

  beforeEach(async () => {
    t = await createTestServer();
    adminUsers = new AdminUserService({
      db: t.services.db,
      users: t.services.users,
      quotas: t.services.quotas,
      sessions: t.services.sessions,
      auth: t.services.auth,
      audit: t.services.audit,
      storageRoot: t.storageRoot,
    });
  });

  afterEach(async () => {
    await t.close();
  });

  it('仅清除锁定与失败次数，不修改密码，解锁后可立即登录', async () => {
    const passwordHash = t.services.users.findById(t.user.id)!.passwordHash;
    const attacker = new TestClient(t.client.baseUrl);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await attacker.login('alice', 'Wrong-password-1').catch(() => {});
    }

    const locked = t.services.users.findById(t.user.id)!;
    assert.equal(locked.failedAttempts, 5);
    assert.ok(locked.lockedUntil !== null && locked.lockedUntil > Date.now());

    adminUsers.unlockUser(t.user.id, { id: 99, username: 'admin' });

    const unlocked = t.services.users.findById(t.user.id)!;
    assert.equal(unlocked.failedAttempts, 0);
    assert.equal(unlocked.lockedUntil, null);
    assert.equal(unlocked.passwordHash, passwordHash);

    const audit = t.services.audit
      .list({ limit: 50 })
      .find((entry) => entry.action === 'user.unlock');
    assert.ok(audit);
    assert.equal(audit.result, 'success');
    assert.equal(audit.targetId, String(t.user.id));

    const client = new TestClient(t.client.baseUrl);
    await client.login('alice', 'Passw0rd!');
    const upload = await client.upload('after-unlock.txt', Buffer.from('still logged in'));
    assert.equal(upload.status, 201);
  });

  it('未锁定时调用也保持密码不变（幂等）', () => {
    const before = t.services.users.findById(t.user.id)!;
    adminUsers.unlockUser(t.user.id, { id: 99, username: 'admin' });
    const after = t.services.users.findById(t.user.id)!;

    assert.equal(after.failedAttempts, 0);
    assert.equal(after.lockedUntil, null);
    assert.equal(after.passwordHash, before.passwordHash);
  });

  it('不存在的用户返回 USER_NOT_FOUND', () => {
    assert.throws(
      () => adminUsers.unlockUser(999_999, { id: 99, username: 'admin' }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'USER_NOT_FOUND',
    );
  });
});
