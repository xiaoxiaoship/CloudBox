import type { Db } from '../connection.ts';

export interface ShareRecord {
  id: number;
  token: string;
  userId: number;
  storageKey: string;
  filePath: string;
  expiresAt: number;
  createdAt: number;
}

interface ShareRow {
  id: number;
  token: string;
  user_id: number;
  storage_key: string;
  file_path: string;
  expires_at: number;
  created_at: number;
}

function mapShare(row: ShareRow): ShareRecord {
  return {
    id: row.id,
    token: row.token,
    userId: row.user_id,
    storageKey: row.storage_key,
    filePath: row.file_path,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export class ShareRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  create(input: {
    token: string;
    userId: number;
    storageKey: string;
    filePath: string;
    expiresAt: number;
    createdAt: number;
  }): ShareRecord {
    const result = this.db
      .prepare(
        `INSERT INTO shares (token, user_id, storage_key, file_path, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.token,
        input.userId,
        input.storageKey,
        input.filePath,
        input.expiresAt,
        input.createdAt,
      );

    const row = this.db
      .prepare('SELECT * FROM shares WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as ShareRow | undefined;
    if (!row) throw new Error('分享记录写入后无法读取');
    return mapShare(row);
  }

  findByToken(token: string): ShareRecord | null {
    const row = this.db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as
      | ShareRow
      | undefined;
    return row ? mapShare(row) : null;
  }

  deleteExpired(now: number): number {
    return this.db.prepare('DELETE FROM shares WHERE expires_at < ?').run(now).changes;
  }
}
