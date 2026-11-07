import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/** better-sqlite3 的数据库实例类型别名，避免各处重复 import */
export type Db = Database.Database;

export interface OpenDatabaseOptions {
  /** 数据库文件绝对路径，或 ':memory:'（测试用） */
  file: string;
  /** 遇到锁时的等待毫秒数，默认 5000 */
  busyTimeoutMs?: number;
  /** 只读模式（备份校验、离线查看等场景） */
  readonly?: boolean;
}

/**
 * 打开 SQLite 连接并应用统一 PRAGMA。
 *
 * 关键点：
 *  - WAL：读写不互相阻塞，适合"Web 读 + 管理端写"的混合负载
 *  - busy_timeout：多语句写入时自动重试，避免 SQLITE_BUSY 直接抛给用户
 *  - foreign_keys：SQLite 默认关闭，必须每个连接显式开启
 *  - synchronous=NORMAL：WAL 下兼顾安全与性能（崩溃最多丢最后一个事务）
 */
export function openDatabase(options: OpenDatabaseOptions): Db {
  const { file, busyTimeoutMs = 5_000, readonly = false } = options;

  if (file !== ':memory:' && !readonly) {
    mkdirSync(dirname(file), { recursive: true });
  }

  const db = new Database(file, { readonly });

  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);

  if (!readonly) {
    const mode = String(db.pragma('journal_mode = WAL', { simple: true })).toLowerCase();
    if (file !== ':memory:' && mode !== 'wal') {
      throw new Error(`无法启用 WAL 模式（当前 journal_mode=${mode}）`);
    }
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('wal_autocheckpoint = 1000');
  }

  return db;
}

/** 幂等关闭，供优雅退出与测试清理复用 */
export function closeDatabase(db: Db): void {
  if (db.open) db.close();
}

/** 轻量健康探测：不抛异常，供 /health 使用 */
export function pingDatabase(db: Db): boolean {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return true;
  } catch {
    return false;
  }
}
