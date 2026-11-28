import type { Db } from '../connection.ts';

export type AnnouncementCategory = 'critical' | 'warning' | 'info';
export type AnnouncementAudience = 'all' | 'user';

export interface AnnouncementRecord {
  id: number;
  authorId: number;
  category: AnnouncementCategory;
  audience: AnnouncementAudience;
  targetUserId: number | null;
  body: string;
  createdAt: number;
}

export interface AnnouncementView extends AnnouncementRecord {
  read: boolean;
  targetUsername: string | null;
}

interface Row {
  id: number;
  author_id: number;
  category: AnnouncementCategory;
  audience: AnnouncementAudience;
  target_user_id: number | null;
  body: string;
  created_at: number;
  read_at?: number | null;
  target_username?: string | null;
}

function map(row: Row): AnnouncementView {
  return {
    id: row.id,
    authorId: row.author_id,
    category: row.category,
    audience: row.audience,
    targetUserId: row.target_user_id,
    body: row.body,
    createdAt: row.created_at,
    read: row.read_at !== undefined && row.read_at !== null,
    targetUsername: row.target_username ?? null,
  };
}

export class AnnouncementRepository {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  create(input: Omit<AnnouncementRecord, 'id'>): AnnouncementRecord {
    const result = this.db.prepare(
      `INSERT INTO announcements (author_id, category, audience, target_user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.authorId, input.category, input.audience, input.targetUserId, input.body, input.createdAt);
    const row = this.db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(result.lastInsertRowid)) as Row;
    return map(row);
  }

  listForUser(userId: number): AnnouncementView[] {
    const rows = this.db.prepare(
      `SELECT a.*, r.read_at
         FROM announcements a
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
        WHERE a.audience = 'all' OR a.target_user_id = ?
        ORDER BY a.created_at DESC
        LIMIT 100`,
    ).all(userId, userId) as Row[];
    return rows.map(map);
  }

  listAll(): AnnouncementView[] {
    const rows = this.db.prepare(
      `SELECT a.*, u.username AS target_username
         FROM announcements a
         LEFT JOIN users u ON u.id = a.target_user_id
        ORDER BY a.created_at DESC
        LIMIT 100`,
    ).all() as Row[];
    return rows.map(map);
  }

  unreadCount(userId: number): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count
         FROM announcements a
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ?
        WHERE (a.audience = 'all' OR a.target_user_id = ?) AND r.read_at IS NULL`,
    ).get(userId, userId) as { count: number };
    return row.count;
  }

  markRead(announcementId: number, userId: number, now: number): void {
    this.db.prepare(
      `INSERT INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)
       ON CONFLICT(announcement_id, user_id) DO NOTHING`,
    ).run(announcementId, userId, now);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM announcements WHERE id = ?').run(id).changes > 0;
  }

  markAllRead(userId: number, now: number): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at)
       SELECT id, ?, ? FROM announcements
        WHERE audience = 'all' OR target_user_id = ?`,
    ).run(userId, now, userId);
  }
}
