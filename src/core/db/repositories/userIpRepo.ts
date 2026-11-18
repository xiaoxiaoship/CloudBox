import type { Db } from '../connection.ts';

export interface UserIpRecord {
  ip: string;
  firstSeenAt: number;
  lastSeenAt: number;
  loginCount: number;
}

interface UserIpRow {
  ip: string;
  first_seen_at: number;
  last_seen_at: number;
  login_count: number;
}

export class UserIpRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  record(userId: number, ip: string, now: number): void {
    if (!ip) return;
    this.db.prepare(
      `INSERT INTO user_login_ips (user_id, ip, first_seen_at, last_seen_at, login_count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(user_id, ip) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         login_count = login_count + 1`,
    ).run(userId, ip, now, now);
  }

  listForUser(userId: number, since = 0): UserIpRecord[] {
    const rows = this.db.prepare(
      'SELECT ip, first_seen_at, last_seen_at, login_count FROM user_login_ips WHERE user_id = ? AND last_seen_at >= ? ORDER BY last_seen_at DESC',
    ).all(userId, since) as UserIpRow[];
    return rows.map((row) => ({
      ip: row.ip,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      loginCount: row.login_count,
    }));
  }

  listAll(): Array<UserIpRecord & { userId: number }> {
    const rows = this.db.prepare(
      'SELECT user_id, ip, first_seen_at, last_seen_at, login_count FROM user_login_ips ORDER BY last_seen_at DESC',
    ).all() as Array<UserIpRow & { user_id: number }>;
    return rows.map((row) => ({
      userId: row.user_id,
      ip: row.ip,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      loginCount: row.login_count,
    }));
  }
}
