import type { Db } from '../connection.ts';
import type { AuditLogRecord, NewAuditLog } from '../../types/models.ts';

interface AuditDbRow {
  id: number;
  ts: number;
  actor_type: string;
  actor_id: number | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_path: string | null;
  result: string;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  detail: string | null;
}

const COLUMNS = `id, ts, actor_type, actor_id, action, target_type, target_id, target_path,
  result, ip, user_agent, request_id, detail`;

function mapAudit(row: AuditDbRow): AuditLogRecord {
  return {
    id: row.id,
    ts: row.ts,
    actorType: row.actor_type as AuditLogRecord['actorType'],
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetPath: row.target_path,
    result: row.result as AuditLogRecord['result'],
    ip: row.ip,
    userAgent: row.user_agent,
    requestId: row.request_id,
    detail: row.detail,
  };
}

export interface ListAuditOptions {
  limit?: number;
  offset?: number;
}

export class AuditRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  insert(entry: NewAuditLog): number {
    const result = this.db
      .prepare(
        `INSERT INTO audit_logs
           (ts, actor_type, actor_id, action, target_type, target_id, target_path,
            result, ip, user_agent, request_id, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.ts,
        entry.actorType,
        entry.actorId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.targetPath,
        entry.result,
        entry.ip,
        entry.userAgent,
        entry.requestId,
        entry.detail,
      );

    return Number(result.lastInsertRowid);
  }

  /** 最新在前；limit 上限 500，避免管理端一次拉爆内存 */
  list(options: ListAuditOptions = {}): AuditLogRecord[] {
    const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 50)), 500);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));

    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM audit_logs ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as AuditDbRow[];

    return rows.map(mapAudit);
  }

  deleteRenameEvents(userId: number, since: number): number {
    return this.db
      .prepare("DELETE FROM audit_logs WHERE action = 'user.rename' AND actor_id = ? AND ts >= ?")
      .run(userId, since).changes;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number };
    return row.n;
  }

  pruneBefore(ts: number): number {
    return this.db.prepare('DELETE FROM audit_logs WHERE ts < ?').run(ts).changes;
  }

  trimToBytes(maxBytes: number): number {
    if (maxBytes <= 0) return 0;
    const row = this.db.prepare("SELECT COALESCE(SUM(length(CAST(detail AS BLOB)) + length(action) + length(COALESCE(target_path, '')) + length(COALESCE(ip, ''))), 0) AS bytes FROM audit_logs").get() as { bytes: number };
    if (row.bytes <= maxBytes) return 0;
    let remaining = row.bytes - maxBytes;
    const ids = this.db.prepare('SELECT id, length(CAST(detail AS BLOB)) + length(action) AS bytes FROM audit_logs ORDER BY ts ASC, id ASC').all() as Array<{ id: number; bytes: number }>;
    const remove: number[] = [];
    for (const entry of ids) {
      remove.push(entry.id);
      remaining -= entry.bytes;
      if (remaining <= 0) break;
    }
    if (remove.length === 0) return 0;
    const placeholders = remove.map(() => '?').join(', ');
    return this.db.prepare(`DELETE FROM audit_logs WHERE id IN (${placeholders})`).run(...remove).changes;
  }
}
