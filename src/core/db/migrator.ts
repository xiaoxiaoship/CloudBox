import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './connection.ts';

/**
 * 源码运行时的默认迁移目录（cwd 为项目根）。
 * Electron 打包后由主进程传入 app.getAppPath()/dist/main/migrations。
 */
export const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src', 'core', 'db', 'migrations');

export interface MigrationReport {
  /** 本次实际执行的迁移文件名 */
  applied: string[];
  /** 应用后的 schema 版本（取最大迁移编号） */
  version: number;
}

interface MigrationFile {
  version: number;
  name: string;
  file: string;
}

const FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/** 建元数据表（必须在 001 之前存在） */
function ensureMetaTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);
}

function loadMigrationFiles(dir: string): MigrationFile[] {
  if (!existsSync(dir)) {
    throw new Error(`迁移目录不存在: ${dir}`);
  }

  const migrations: MigrationFile[] = [];
  for (const entry of readdirSync(dir)) {
    const match = FILE_PATTERN.exec(entry);
    if (!match) continue;
    const version = Number(match[1]);
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`迁移文件编号非法: ${entry}`);
    }
    migrations.push({ version, name: entry, file: path.join(dir, entry) });
  }

  migrations.sort((a, b) => a.version - b.version);

  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i]!.version === migrations[i - 1]!.version) {
      throw new Error(`迁移版本重复: ${migrations[i]!.version}`);
    }
  }

  return migrations;
}

/**
 * 顺序执行未应用的迁移。
 *
 * 安全保证：
 *  - 每个迁移在独立事务中执行，失败整体回滚
 *  - 记录已应用版本，重复调用是幂等的
 *  - 若数据库版本高于本地迁移文件（降级启动），直接拒绝，避免旧代码破坏新 schema
 */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): MigrationReport {
  ensureMetaTable(db);

  const files = loadMigrationFiles(dir);
  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const knownVersions = new Set(files.map((file) => file.version));

  const unknown = appliedRows.filter((row) => !knownVersions.has(row.version));
  if (unknown.length > 0) {
    throw new Error(
      `数据库 schema 版本高于当前程序（已应用: ${unknown.map((row) => row.version).join(', ')}），请升级程序而不是降级运行`,
    );
  }

  const pending = files.filter((file) => !appliedVersions.has(file.version));
  const applied: string[] = [];

  for (const migration of pending) {
    const sql = readFileSync(migration.file, 'utf8');
    const record = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );

    db.transaction(() => {
      db.exec(sql);
      record.run(migration.version, migration.name, Date.now());
    })();

    applied.push(migration.name);
  }

  const version = files.length > 0 ? files[files.length - 1]!.version : 0;
  db.pragma(`user_version = ${version}`);

  return { applied, version };
}
