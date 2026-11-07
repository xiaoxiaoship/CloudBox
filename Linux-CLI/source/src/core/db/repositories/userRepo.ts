import type { Db } from '../connection.ts';
import type { UserRecord, UserRole, UserStatus } from '../../types/models.ts';

interface UserDbRow {
  id: number;
  storage_key: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  status: string;
  must_change_password: number;
  failed_attempts: number;
  locked_until: number | null;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

const COLUMNS = `id, storage_key, username, display_name, password_hash, role, status,
  must_change_password, failed_attempts, locked_until, last_login_at, created_at, updated_at`;

function mapUser(row: UserDbRow): UserRecord {
  return {
    id: row.id,
    storageKey: row.storage_key,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    mustChangePassword: row.must_change_password === 1,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateUserInput {
  storageKey: string;
  username: string;
  passwordHash: string;
  role?: UserRole;
  displayName?: string;
  status?: UserStatus;
  mustChangePassword?: boolean;
  createdAt: number;
}

export class UserRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  findById(id: number): UserRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as
      | UserDbRow
      | undefined;
    return row ? mapUser(row) : null;
  }

  /** 用户名使用 NOCASE 排序规则，大小写不敏感 */
  findByUsername(username: string): UserRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE username = ?`).get(username) as
      | UserDbRow
      | undefined;
    return row ? mapUser(row) : null;
  }

  findByStorageKey(storageKey: string): UserRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM users WHERE storage_key = ?`)
      .get(storageKey) as UserDbRow | undefined;
    return row ? mapUser(row) : null;
  }

  findAdmin(): UserRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM users WHERE role = 'admin' LIMIT 1`)
      .get() as UserDbRow | undefined;
    return row ? mapUser(row) : null;
  }

  list(): UserRecord[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM users ORDER BY id ASC`)
      .all() as UserDbRow[];
    return rows.map(mapUser);
  }

  create(input: CreateUserInput): UserRecord {
    const result = this.db
      .prepare(
        `INSERT INTO users
           (storage_key, username, display_name, password_hash, role, status,
            must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.storageKey,
        input.username,
        input.displayName ?? '',
        input.passwordHash,
        input.role ?? 'user',
        input.status ?? 'active',
        input.mustChangePassword ? 1 : 0,
        input.createdAt,
        input.createdAt,
      );

    return this.findById(Number(result.lastInsertRowid))!;
  }

  updatePasswordHash(id: number, passwordHash: string, now: number): boolean {
    return (
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, now, id).changes > 0
    );
  }

  recordLoginSuccess(id: number, now: number): void {
    this.db
      .prepare(
        `UPDATE users
            SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(now, now, id);
  }

  recordLoginFailure(id: number, now: number, lockedUntil: number | null): void {
    this.db
      .prepare(
        `UPDATE users
            SET failed_attempts = failed_attempts + 1, locked_until = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(lockedUntil, now, id);
  }

  resetFailures(id: number, now: number): void {
    this.db
      .prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(now, id);
  }

  setStatus(id: number, status: UserStatus, now: number): boolean {
    return (
      this.db
        .prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now, id).changes > 0
    );
  }

  setMustChangePassword(id: number, required: boolean, now: number): boolean {
    return (
      this.db
        .prepare('UPDATE users SET must_change_password = ?, updated_at = ? WHERE id = ?')
        .run(required ? 1 : 0, now, id).changes > 0
    );
  }

  countByRole(role: UserRole): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?').get(role) as {
      n: number;
    };
    return row.n;
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  }
}
