import type { Db } from '../../db/connection.ts';

export interface AdminSessionRecord {
  idHash: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
  revokedAt: number | null;
}

interface AdminSessionRow {
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

function mapRow(row: AdminSessionRow): AdminSessionRecord {
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

export class AdminSessionRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  create(input: {
    idHash: string;
    userId: number;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    ip: string | null;
    userAgent: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO admin_sessions
           (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
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

  get(idHash: string): AdminSessionRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM admin_sessions WHERE id_hash = ?`)
      .get(idHash) as AdminSessionRow | undefined;
    return row ? mapRow(row) : null;
  }

  touch(idHash: string, now: number): void {
    this.db
      .prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
      .run(now, idHash);
  }

  revoke(idHash: string, now: number): void {
    this.db
      .prepare('UPDATE admin_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
      .run(now, idHash);
  }

  deleteExpired(now: number): number {
    return this.db
      .prepare('DELETE FROM admin_sessions WHERE expires_at <= ?')
      .run(now).changes;
  }
}
