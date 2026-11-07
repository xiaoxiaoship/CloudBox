import type { Db } from '../connection.ts';
import type { QuotaRecord } from '../../types/models.ts';

interface QuotaDbRow {
  user_id: number;
  quota_bytes: number | null;
  used_bytes: number;
  updated_at: number;
}

function mapQuota(row: QuotaDbRow): QuotaRecord {
  return {
    userId: row.user_id,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    updatedAt: row.updated_at,
  };
}

export class QuotaRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(userId: number): QuotaRecord | null {
    const row = this.db
      .prepare('SELECT user_id, quota_bytes, used_bytes, updated_at FROM quotas WHERE user_id = ?')
      .get(userId) as QuotaDbRow | undefined;
    return row ? mapQuota(row) : null;
  }

  /** 幂等创建；quotaBytes 为 null 表示不限量 */
  ensure(userId: number, quotaBytes: number | null, now: number): QuotaRecord {
    this.db
      .prepare(
        `INSERT INTO quotas (user_id, quota_bytes, used_bytes, updated_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .run(userId, quotaBytes, now);

    return this.get(userId)!;
  }

  setQuota(userId: number, quotaBytes: number | null, now: number): boolean {
    return (
      this.db
        .prepare('UPDATE quotas SET quota_bytes = ?, updated_at = ? WHERE user_id = ?')
        .run(quotaBytes, now, userId).changes > 0
    );
  }

  setUsed(userId: number, usedBytes: number, now: number): boolean {
    return (
      this.db
        .prepare('UPDATE quotas SET used_bytes = ?, updated_at = ? WHERE user_id = ?')
        .run(Math.max(0, usedBytes), now, userId).changes > 0
    );
  }

  /** 增量更新用量；结果不会被压到负数（删除文件时的保护） */
  addUsed(userId: number, deltaBytes: number, now: number): QuotaRecord | null {
    this.db
      .prepare(
        `UPDATE quotas
            SET used_bytes = CASE
                  WHEN used_bytes + ? < 0 THEN 0
                  ELSE used_bytes + ?
                END,
                updated_at = ?
          WHERE user_id = ?`,
      )
      .run(deltaBytes, deltaBytes, now, userId);

    return this.get(userId);
  }
}
