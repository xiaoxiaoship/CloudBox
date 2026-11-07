import type { Db } from '../connection.ts';

export interface SettingRecord {
  key: string;
  value: string;
  updatedAt: number;
  updatedBy: number | null;
}

interface SettingDbRow {
  key: string;
  value: string;
  updated_at: number;
  updated_by: number | null;
}

export class SettingsRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** 返回原始 JSON 文本；不存在返回 null（由 SettingsService 套默认值） */
  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  getAll(): SettingRecord[] {
    const rows = this.db
      .prepare('SELECT key, value, updated_at, updated_by FROM settings ORDER BY key')
      .all() as SettingDbRow[];
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    }));
  }

  set(key: string, valueJson: string, updatedBy: number | null, now: number): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run(key, valueJson, now, updatedBy);
  }

  remove(key: string): boolean {
    return this.db.prepare('DELETE FROM settings WHERE key = ?').run(key).changes > 0;
  }
}
