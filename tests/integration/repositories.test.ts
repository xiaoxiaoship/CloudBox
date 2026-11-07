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
import { AuditService } from '../../src/core/services/auditService.ts';
import { SettingsService } from '../../src/core/services/settingsService.ts';

const BASE_TIME = Date.UTC(2026, 0, 1);

describe('repositories', () => {
  let db: Db;
  let users: UserRepository;
  let quotas: QuotaRepository;
  let sessions: SessionRepository;
  let settingsRepo: SettingsRepository;
  let auditRepo: AuditRepository;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    migrate(db);
    users = new UserRepository(db);
    quotas = new QuotaRepository(db);
    sessions = new SessionRepository(db);
    settingsRepo = new SettingsRepository(db);
    auditRepo = new AuditRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('用户创建 / 按用户名大小写不敏感查找 / 唯一约束', () => {
    const user = users.create({
      storageKey: randomUUID(),
      username: 'Alice',
      passwordHash: 'hash',
      createdAt: BASE_TIME,
    });

    assert.equal(user.username, 'Alice');
    assert.equal(user.role, 'user');
    assert.equal(user.status, 'active');
    assert.equal(user.mustChangePassword, false);

    assert.equal(users.findByUsername('alice')?.id, user.id);
    assert.equal(users.findByUsername('ALICE')?.id, user.id);
    assert.equal(users.findById(user.id)?.storageKey, user.storageKey);

    assert.throws(
      () =>
        users.create({
          storageKey: randomUUID(),
          username: 'alice',
          passwordHash: 'hash2',
          createdAt: BASE_TIME,
        }),
      /UNIQUE/i,
    );
  });

  it('单管理员约束在仓储层同样生效', () => {
    users.create({
      storageKey: randomUUID(),
      username: 'root',
      passwordHash: 'hash',
      role: 'admin',
      createdAt: BASE_TIME,
    });

    assert.throws(
      () =>
        users.create({
          storageKey: randomUUID(),
          username: 'root2',
          passwordHash: 'hash',
          role: 'admin',
          createdAt: BASE_TIME,
        }),
      /UNIQUE/i,
    );
  });

  it('配额 ensure 幂等，addUsed 不会压成负数', () => {
    const user = users.create({
      storageKey: randomUUID(),
      username: 'bob',
      passwordHash: 'hash',
      createdAt: BASE_TIME,
    });

    const created = quotas.ensure(user.id, 1_000, BASE_TIME);
    assert.equal(created.quotaBytes, 1_000);
    assert.equal(created.usedBytes, 0);

    const again = quotas.ensure(user.id, 999_999, BASE_TIME);
    assert.equal(again.quotaBytes, 1_000, '已存在时 ensure 不应覆盖配额');

    assert.equal(quotas.addUsed(user.id, 400, BASE_TIME)?.usedBytes, 400);
    assert.equal(quotas.addUsed(user.id, -1_000, BASE_TIME)?.usedBytes, 0);

    quotas.setQuota(user.id, null, BASE_TIME);
    assert.equal(quotas.get(user.id)?.quotaBytes, null);
  });

  it('会话创建 / 查询 / 吊销 / 过期清理', () => {
    const user = users.create({
      storageKey: randomUUID(),
      username: 'carol',
      passwordHash: 'hash',
      createdAt: BASE_TIME,
    });

    sessions.create({
      idHash: 'hash-1',
      userId: user.id,
      createdAt: BASE_TIME,
      lastSeenAt: BASE_TIME,
      expiresAt: BASE_TIME + 1_000,
      ip: '127.0.0.1',
      userAgent: 'test',
    });
    sessions.create({
      idHash: 'hash-2',
      userId: user.id,
      createdAt: BASE_TIME,
      lastSeenAt: BASE_TIME,
      expiresAt: BASE_TIME + 10_000,
      ip: null,
      userAgent: null,
    });

    assert.equal(sessions.findByHash('hash-1')?.userId, user.id);
    assert.equal(sessions.countActive(user.id, BASE_TIME), 2);

    sessions.touch('hash-1', BASE_TIME + 500);
    assert.equal(sessions.findByHash('hash-1')?.lastSeenAt, BASE_TIME + 500);

    assert.equal(sessions.revoke('hash-1', BASE_TIME + 600), true);
    assert.equal(sessions.revoke('hash-1', BASE_TIME + 700), false, '重复吊销应返回 false');
    assert.equal(sessions.countActive(user.id, BASE_TIME + 800), 1);

    assert.equal(sessions.deleteExpired(BASE_TIME + 2_000), 1);
    assert.equal(sessions.findByHash('hash-1'), null);

    assert.equal(sessions.revokeAllForUser(user.id, BASE_TIME + 3_000), 1);
    assert.equal(sessions.countActive(user.id, BASE_TIME + 3_000), 0);
  });

  it('设置服务提供默认值、校验与损坏值回退', () => {
    const settings = new SettingsService(settingsRepo, () => BASE_TIME);

    assert.equal(settings.get('server.port'), 8686);
    assert.equal(settings.get('security.maxLoginFailures'), 5);

    settings.set('security.sessionTtlHours', 24, null);
    assert.equal(settings.get('security.sessionTtlHours'), 24);
    assert.equal(settingsRepo.get('security.sessionTtlHours'), '24');

    // 模拟数据库被手工改坏
    settingsRepo.set('server.port', '"not-a-number"', null, BASE_TIME);
    assert.equal(settings.get('server.port'), 8686);

    assert.throws(() => settings.set('server.port', 80), /非法/);
  });

  it('审计写入 / 倒序读取 / 详情截断', () => {
    const audit = new AuditService(auditRepo, () => BASE_TIME);

    for (let i = 0; i < 3; i += 1) {
      audit.record({
        actorType: 'admin',
        actorId: 1,
        action: 'test.action',
        result: 'success',
        detail: { index: i },
      });
    }

    const rows = audit.list({ limit: 2 });
    assert.equal(rows.length, 2);
    assert.deepEqual(JSON.parse(rows[0]!.detail!), { index: 2 });
    assert.deepEqual(JSON.parse(rows[1]!.detail!), { index: 1 });

    audit.record({
      actorType: 'system',
      action: 'test.long',
      result: 'error',
      detail: { payload: 'x'.repeat(5_000) },
    });
    const longRow = audit.list({ limit: 1 })[0]!;
    assert.ok(longRow.detail!.length <= 4_097);
    assert.ok(longRow.detail!.endsWith('…'));

    assert.equal(auditRepo.count(), 4);
    assert.equal(auditRepo.pruneBefore(BASE_TIME + 1), 4);
  });
});
