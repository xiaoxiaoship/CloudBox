import type { Db } from '../connection.ts';

export interface HostingRecord {
  userId: number;
  rootPath: string;
  enabled: boolean;
  visibility: 'public' | 'private';
  updatedAt: number;
}

interface Row {
  user_id: number;
  root_path: string;
  enabled: number;
  visibility: 'public' | 'private';
  updated_at: number;
}

function map(row: Row): HostingRecord {
  return {
    userId: row.user_id,
    rootPath: row.root_path,
    enabled: row.enabled === 1,
    visibility: row.visibility,
    updatedAt: row.updated_at,
  };
}

export class HostingRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(userId: number): HostingRecord | null {
    const row = this.db.prepare('SELECT * FROM user_hosting WHERE user_id = ?').get(userId) as
      | Row
      | undefined;
    return row ? map(row) : null;
  }

  findByUsername(username: string): { user: unknown; record: HostingRecord } | null {
    const row = this.db
      .prepare(
        `SELECT h.*, u.id AS uid FROM user_hosting h JOIN users u ON u.id = h.user_id
         WHERE u.username = ? COLLATE NOCASE LIMIT 1`,
      )
      .get(username) as (Row & { uid: number }) | undefined;
    return row ? { user: row.uid, record: map(row) } : null;
  }

  upsert(record: HostingRecord): void {
    this.db
      .prepare(
        `INSERT INTO user_hosting (user_id, root_path, enabled, visibility, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           root_path = excluded.root_path,
           enabled = excluded.enabled,
           visibility = excluded.visibility,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.userId,
        record.rootPath,
        record.enabled ? 1 : 0,
        record.visibility,
        record.updatedAt,
      );
  }
}
