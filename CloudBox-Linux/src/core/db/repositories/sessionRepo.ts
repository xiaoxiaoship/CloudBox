import type { Db } from '../connection.ts';
import type { SessionRecord } from '../../types/models.ts';

interface SessionDbRow {
  id_hash: string;
  user_id: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
  revoked_at: number | null;
}

const COLUMNS = 'id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at';

function mapSession(row: SessionDbRow): SessionRecord {
  return {
    idHash: row.id_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
    revokedAt: row.revoked_at,
  };
}

export interface CreateSessionInput {
  idHash: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
}

export class SessionRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  create(input: CreateSessionInput): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.idHash,
        input.userId,
        input.createdAt,
        input.lastSeenAt,
        input.expiresAt,
        input.ip,
        input.userAgent,
      );
  }

  findByHash(idHash: string): SessionRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM sessions WHERE id_hash = ?`)
      .get(idHash) as SessionDbRow | undefined;
    return row ? mapSession(row) : null;
  }

  touch(idHash: string, now: number): void {
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
      .run(now, idHash);
  }

  revoke(idHash: string, now: number): boolean {
    return (
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
        .run(now, idHash).changes > 0
    );
  }

  /** 改密 / 禁用 / 删除用户时强制下线所有设备 */
  revokeAllForUser(userId: number, now: number): number {
    return this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(now, userId).changes;
  }

  deleteExpired(now: number): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
  }

  countActive(userId: number, now: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM sessions
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(userId, now) as { n: number };
    return row.n;
  }
}
