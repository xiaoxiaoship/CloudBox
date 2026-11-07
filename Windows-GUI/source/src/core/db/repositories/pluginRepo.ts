import type { Db } from '../connection.ts';

export interface PluginRecord {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  allowWebOverride: boolean;
  installedAt: number;
  manifestJson: string;
}

interface PluginRow {
  name: string;
  version: string;
  description: string;
  enabled: number;
  allow_web_override: number;
  installed_at: number;
  manifest_json: string;
}

function map(row: PluginRow): PluginRecord {
  return {
    name: row.name,
    version: row.version,
    description: row.description,
    enabled: row.enabled === 1,
    allowWebOverride: row.allow_web_override === 1,
    installedAt: row.installed_at,
    manifestJson: row.manifest_json,
  };
}

export class PluginRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): PluginRecord[] {
    return (this.db.prepare('SELECT * FROM plugins ORDER BY installed_at ASC').all() as PluginRow[]).map(map);
  }

  get(name: string): PluginRecord | null {
    const row = this.db.prepare('SELECT * FROM plugins WHERE name = ?').get(name) as
      | PluginRow
      | undefined;
    return row ? map(row) : null;
  }

  upsert(input: PluginRecord): void {
    this.db
      .prepare(
        `INSERT INTO plugins
           (name, version, description, enabled, allow_web_override, installed_at, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           version = excluded.version,
           description = excluded.description,
           manifest_json = excluded.manifest_json`,
      )
      .run(
        input.name,
        input.version,
        input.description,
        input.enabled ? 1 : 0,
        input.allowWebOverride ? 1 : 0,
        input.installedAt,
        input.manifestJson,
      );
  }

  setEnabled(name: string, enabled: boolean): void {
    this.db.prepare('UPDATE plugins SET enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name);
  }

  setAllowWebOverride(name: string, allowed: boolean): void {
    this.db
      .prepare('UPDATE plugins SET allow_web_override = ? WHERE name = ?')
      .run(allowed ? 1 : 0, name);
  }

  remove(name: string): void {
    this.db.prepare('DELETE FROM plugins WHERE name = ?').run(name);
  }
}
