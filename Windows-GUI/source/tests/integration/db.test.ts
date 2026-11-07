import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { closeDatabase, openDatabase } from '../../src/core/db/connection.ts';
import { migrate } from '../../src/core/db/migrator.ts';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cloudbox-db-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe('database connection & migrations', () => {
  it('内存库执行迁移且可重复调用', () => {
    const db = openDatabase({ file: ':memory:' });
    try {
      const first = migrate(db);
      assert.deepEqual(first.applied, [
        '001_init.sql',
        '002_shares.sql',
        '003_scans.sql',
        '004_plugins.sql',
        '005_ai.sql',
        '006_hosting.sql',
        '007_avatar.sql',
      ]);
      assert.equal(first.version, 7);

      const second = migrate(db);
      assert.deepEqual(second.applied, []);
      assert.equal(second.version, 7);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((row) => row.name);
      for (const expected of [
        'users',
        'quotas',
        'sessions',
        'settings',
        'audit_logs',
        'shares',
        'file_scans',
        'plugins',
        'user_ai_settings',
        'user_hosting',
        'schema_migrations',
      ]) {
        assert.ok(names.includes(expected), `缺少表 ${expected}`);
      }
    } finally {
      closeDatabase(db);
    }
  });

  it('默认设置已种入，且 user_version 被记录', () => {
    const db = openDatabase({ file: ':memory:' });
    try {
      migrate(db);
      const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{
        key: string;
        value: string;
      }>;
      const map = new Map(settings.map((row) => [row.key, row.value]));
      assert.equal(map.get('server.online'), 'false');
      assert.equal(map.get('server.port'), '8686');
      assert.equal(map.get('upload.maxFileBytes'), '2147483648');
      assert.equal(db.pragma('user_version', { simple: true }), 7);
    } finally {
      closeDatabase(db);
    }
  });

  it('外键级联生效（删除用户会清掉配额与会话）', () => {
    const db = openDatabase({ file: ':memory:' });
    try {
      migrate(db);
      const now = Date.now();
      const user = db
        .prepare(
          `INSERT INTO users (storage_key, username, password_hash, role, created_at, updated_at)
           VALUES (?, ?, ?, 'user', ?, ?)`,
        )
        .run('key-1', 'alice', 'scrypt$dummy', now, now);

      db.prepare('INSERT INTO quotas (user_id, quota_bytes, updated_at) VALUES (?, ?, ?)').run(
        user.lastInsertRowid,
        1024,
        now,
      );
      db.prepare(
        `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('hash-1', user.lastInsertRowid, now, now, now + 1000);

      db.prepare('DELETE FROM users WHERE id = ?').run(user.lastInsertRowid);

      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM quotas').get() as { n: number }).n, 0);
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);
    } finally {
      closeDatabase(db);
    }
  });

  it('单管理员由部分唯一索引强制', () => {
    const db = openDatabase({ file: ':memory:' });
    try {
      migrate(db);
      const now = Date.now();
      const insert = db.prepare(
        `INSERT INTO users (storage_key, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', ?, ?)`,
      );
      insert.run('admin-key-1', 'admin', 'hash', now, now);

      assert.throws(() => insert.run('admin-key-2', 'admin2', 'hash', now, now), /UNIQUE/i);
    } finally {
      closeDatabase(db);
    }
  });

  it('文件库启用 WAL', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'cloudbox.db');
    const db = openDatabase({ file });
    try {
      migrate(db);
      assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal');
      assert.equal(String(db.pragma('foreign_keys', { simple: true })), '1');
    } finally {
      closeDatabase(db);
    }
  });

  it('数据库版本高于程序时拒绝启动（禁止降级破坏 schema）', () => {
    const db = openDatabase({ file: ':memory:' });
    try {
      migrate(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        999,
        '999_future.sql',
        Date.now(),
      );
      assert.throws(() => migrate(db), /版本高于当前程序/);
    } finally {
      closeDatabase(db);
    }
  });
});
