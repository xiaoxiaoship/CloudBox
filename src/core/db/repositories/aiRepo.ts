import type { Db } from '../connection.ts';

export interface UserAiSettings {
  userId: number;
  baseUrl: string;
  model: string;
  apiKeyEnc: string;
  dailyLimit: number;
  workScope: 'folder' | 'all';
  workDir: string;
  usedDate: string;
  usedCount: number;
  updatedAt: number;
}

interface Row {
  user_id: number;
  base_url: string;
  model: string;
  api_key_enc: string;
  daily_limit: number;
  work_scope: 'folder' | 'all';
  work_dir: string;
  used_date: string;
  used_count: number;
  updated_at: number;
}

function map(row: Row): UserAiSettings {
  return {
    userId: row.user_id,
    baseUrl: row.base_url,
    model: row.model,
    apiKeyEnc: row.api_key_enc,
    dailyLimit: row.daily_limit,
    workScope: row.work_scope,
    workDir: row.work_dir,
    usedDate: row.used_date,
    usedCount: row.used_count,
    updatedAt: row.updated_at,
  };
}

export class AiRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(userId: number): UserAiSettings | null {
    const row = this.db
      .prepare('SELECT * FROM user_ai_settings WHERE user_id = ?')
      .get(userId) as Row | undefined;
    return row ? map(row) : null;
  }

  upsert(input: Partial<UserAiSettings> & { userId: number; updatedAt: number }): void {
    const existing = this.get(input.userId);
    const value = {
      baseUrl: input.baseUrl ?? existing?.baseUrl ?? '',
      model: input.model ?? existing?.model ?? '',
      apiKeyEnc: input.apiKeyEnc ?? existing?.apiKeyEnc ?? '',
      dailyLimit: input.dailyLimit ?? existing?.dailyLimit ?? 50,
      workScope: input.workScope ?? existing?.workScope ?? 'folder',
      workDir: input.workDir ?? existing?.workDir ?? '',
      usedDate: input.usedDate ?? existing?.usedDate ?? '',
      usedCount: input.usedCount ?? existing?.usedCount ?? 0,
    };
    this.db
      .prepare(
        `INSERT INTO user_ai_settings
          (user_id, base_url, model, api_key_enc, daily_limit, work_scope, work_dir, used_date, used_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           base_url = excluded.base_url,
           model = excluded.model,
           api_key_enc = excluded.api_key_enc,
           daily_limit = excluded.daily_limit,
           work_scope = excluded.work_scope,
           work_dir = excluded.work_dir,
           used_date = excluded.used_date,
           used_count = excluded.used_count,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.userId,
        value.baseUrl,
        value.model,
        value.apiKeyEnc,
        value.dailyLimit,
        value.workScope,
        value.workDir,
        value.usedDate,
        value.usedCount,
        input.updatedAt,
      );
  }

  incrementUsage(userId: number, date: string, now: number): void {
    const existing = this.get(userId);
    const count = existing?.usedDate === date ? existing.usedCount + 1 : 1;
    this.upsert({ userId, usedDate: date, usedCount: count, updatedAt: now });
  }
}
