import type { Db } from '../connection.ts';

export type ScanStatus = 'clean' | 'infected' | 'failed';

export interface FileScanRecord {
  userId: number;
  filePath: string;
  status: ScanStatus;
  sha256: string | null;
  engine: string | null;
  details: string | null;
  scannedAt: number;
}

interface ScanRow {
  user_id: number;
  file_path: string;
  status: ScanStatus;
  sha256: string | null;
  engine: string | null;
  details: string | null;
  scanned_at: number;
}

function mapRow(row: ScanRow): FileScanRecord {
  return {
    userId: row.user_id,
    filePath: row.file_path,
    status: row.status,
    sha256: row.sha256,
    engine: row.engine,
    details: row.details,
    scannedAt: row.scanned_at,
  };
}

export class ScanRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(userId: number, filePath: string): FileScanRecord | null {
    const row = this.db
      .prepare('SELECT * FROM file_scans WHERE user_id = ? AND file_path = ?')
      .get(userId, filePath) as ScanRow | undefined;
    return row ? mapRow(row) : null;
  }

  upsert(input: FileScanRecord): void {
    this.db
      .prepare(
        `INSERT INTO file_scans
           (user_id, file_path, status, sha256, engine, details, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, file_path) DO UPDATE SET
           status = excluded.status,
           sha256 = excluded.sha256,
           engine = excluded.engine,
           details = excluded.details,
           scanned_at = excluded.scanned_at`,
      )
      .run(
        input.userId,
        input.filePath,
        input.status,
        input.sha256,
        input.engine,
        input.details,
        input.scannedAt,
      );
  }

  clear(userId: number, filePath: string): void {
    this.db
      .prepare('DELETE FROM file_scans WHERE user_id = ? AND file_path = ?')
      .run(userId, filePath);
  }

  isInfected(userId: number, filePath: string): boolean {
    return this.get(userId, filePath)?.status === 'infected';
  }
}
