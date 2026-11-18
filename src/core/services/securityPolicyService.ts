import type { Db } from '../db/connection.ts';
import type { SettingsService } from './settingsService.ts';

export type PolicyScope = 'ip' | 'account' | 'global';
export interface PolicyRule { feature: string; scope: PolicyScope; config: Record<string, number | string>; }
export interface AccessLists { ipAllow: string[]; ipDeny: string[]; accountAllow: string[]; accountDeny: string[]; }
export interface SecurityPolicy { rules: PolicyRule[]; ipBan?: { threshold: number; minutes: number }; accountBan?: { threshold: number; minutes: number }; globalBan?: { threshold: number; recoveryMinutes: number }; accessLists?: AccessLists; }
export interface SecurityBan { id: number; scope: PolicyScope; target: string; feature: string; until: number; createdAt: number; }

export class SecurityPolicyService {
  onGlobalLimit?: () => void;
  private globalLimitTriggered = false;
  private readonly db: Db;
  private readonly settings: SettingsService;
  private readonly now: () => number;

  constructor(db: Db, settings: SettingsService, now: () => number = Date.now) {
    this.db = db;
    this.settings = settings;
    this.now = now;
  }

  policy(): SecurityPolicy {
    const raw = this.settings.get('security.policy');
    if (!raw) return { rules: [] };
    try {
      const parsed = JSON.parse(raw) as SecurityPolicy;
      return { rules: Array.isArray(parsed.rules) ? parsed.rules : [], ...(parsed.ipBan ? { ipBan: parsed.ipBan } : {}), ...(parsed.accountBan ? { accountBan: parsed.accountBan } : {}), ...(parsed.globalBan ? { globalBan: parsed.globalBan } : {}), ...(parsed.accessLists ? { accessLists: parsed.accessLists } : {}) };
    } catch { return { rules: [] }; }
  }

  accessLists(): AccessLists {
    const lists = this.policy().accessLists;
    return {
      ipAllow: Array.isArray(lists?.ipAllow) ? lists.ipAllow : [],
      ipDeny: Array.isArray(lists?.ipDeny) ? lists.ipDeny : [],
      accountAllow: Array.isArray(lists?.accountAllow) ? lists.accountAllow : [],
      accountDeny: Array.isArray(lists?.accountDeny) ? lists.accountDeny : [],
    };
  }

  isAllowed(scope: PolicyScope, target: string): boolean {
    const lists = this.accessLists();
    if (scope === 'global') return false;
    return (scope === 'ip' ? lists.ipAllow : lists.accountAllow).includes(target);
  }

  isDenied(scope: PolicyScope, target: string): boolean {
    const lists = this.accessLists();
    if (scope === 'global') return false;
    return (scope === 'ip' ? lists.ipDeny : lists.accountDeny).includes(target);
  }

  addCount(scope: PolicyScope, target: string, feature: string, value: number): number {
    const now = this.now();
    this.db.prepare(
      'INSERT INTO security_policy_counts (scope, target, feature, count, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, target, feature) DO UPDATE SET count = count + excluded.count, updated_at = excluded.updated_at',
    ).run(scope, target, feature, Math.max(1, Math.trunc(value)), now);
    const row = this.db.prepare('SELECT count FROM security_policy_counts WHERE scope = ? AND target = ? AND feature = ?').get(scope, target, feature) as { count: number };
    const global = this.policy().globalBan;
    if (!this.globalLimitTriggered && global && this.totalCount() >= Math.max(1, Number(global.threshold ?? 10))) {
      this.globalLimitTriggered = true;
      this.onGlobalLimit?.();
    }
    return row.count;
  }

  countOf(scope: PolicyScope, target: string, feature: string): number {
    const row = this.db.prepare('SELECT count FROM security_policy_counts WHERE scope = ? AND target = ? AND feature = ?').get(scope, target, feature) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  listCounts(): Array<{ scope: PolicyScope; target: string; feature: string; count: number; updatedAt: number }> {
    return this.db.prepare('SELECT scope, target, feature, count, updated_at FROM security_policy_counts ORDER BY updated_at DESC').all() as Array<{ scope: PolicyScope; target: string; feature: string; count: number; updatedAt: number }>;
  }

  clearCount(scope: PolicyScope, target: string, feature: string): void {
    this.db.prepare('DELETE FROM security_policy_counts WHERE scope = ? AND target = ? AND feature = ?').run(scope, target, feature);
  }

  clearAllCounts(): void {
    this.db.prepare('DELETE FROM security_policy_counts').run();
    this.globalLimitTriggered = false;
  }

  totalCount(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM security_policy_counts').get() as { total: number };
    return row.total;
  }

  rule(feature: string, scope: PolicyScope): PolicyRule | null {
    return this.policy().rules.find((entry) => entry.feature === feature && entry.scope === scope) ?? null;
  }

  activeBan(scope: PolicyScope, target: string): SecurityBan | null {
    const row = this.db.prepare(
      'SELECT id, scope, target, feature, until, created_at FROM security_bans WHERE scope = ? AND target = ? AND until > ? ORDER BY until DESC LIMIT 1',
    ).get(scope, target, this.now()) as { id: number; scope: PolicyScope; target: string; feature: string; until: number; created_at: number } | undefined;
    return row ? { id: row.id, scope: row.scope, target: row.target, feature: row.feature, until: row.until, createdAt: row.created_at } : null;
  }

  listActive(): SecurityBan[] {
    const rows = this.db.prepare(
      'SELECT id, scope, target, feature, until, created_at FROM security_bans WHERE until > ? ORDER BY until ASC',
    ).all(this.now()) as Array<{ id: number; scope: PolicyScope; target: string; feature: string; until: number; created_at: number }>;
    return rows.map((row) => ({ id: row.id, scope: row.scope, target: row.target, feature: row.feature, until: row.until, createdAt: row.created_at }));
  }

  recordExternalBan(scope: PolicyScope, target: string, feature: string, minutes: number): SecurityBan {
    const now = this.now();
    return this.insert(scope, target, feature, now + Math.max(1, minutes) * 60_000, now);
  }

  ban(scope: PolicyScope, target: string, feature: string, minutes: number): SecurityBan {
    const now = this.now();
    if (minutes < 0) {
      this.addCount(scope, target, feature, Math.max(1, Number(this.rule(feature, scope)?.config.recordValue ?? 1)));
      return { id: 0, scope, target, feature, until: now, createdAt: now };
    }
    if (feature === 'global') {
      const created = this.insert(scope, target, feature, minutes <= 0 ? Number.MAX_SAFE_INTEGER : now + Math.max(1, minutes) * 60_000, now);
      this.countGlobal(scope);
      return created;
    }
    const created = this.insert(scope, target, feature, minutes <= 0 ? Number.MAX_SAFE_INTEGER : now + Math.max(1, minutes) * 60_000, now);
    this.addCount(scope, target, feature, Math.max(1, Number(this.rule(feature, scope)?.config.recordValue ?? 1)));
    this.markReset(scope, target, now);
    if (scope === 'account' && (feature === 'loginFailure' || feature === 'global')) {
      const userId = Number(target);
      if (Number.isSafeInteger(userId)) this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
    }
    const global = scope === 'ip' ? this.policy().ipBan : this.policy().accountBan;
    const threshold = Math.max(1, Number(global?.threshold ?? 10));
    const active = this.db.prepare(
      'SELECT DISTINCT feature FROM security_bans WHERE scope = ? AND target = ? AND until > ? AND feature != \'global\'',
    ).all(scope, target, now) as Array<{ feature: string }>;
    const recorded = active.reduce((sum, row) => sum + Math.max(1, Number(this.rule(row.feature, scope)?.config.recordValue ?? 1)), 0);
    if (recorded >= threshold) {
      this.clearFeatureBans(scope, target);
      const globalMinutes = Number(global?.minutes ?? 30);
      const globalBan = this.insert(scope, target, 'global', globalMinutes <= 0 ? Number.MAX_SAFE_INTEGER : now + Math.max(1, globalMinutes) * 60_000, now);
      this.markReset(scope, target, now);
      this.countGlobal(scope);
      return globalBan;
    }
    return created;
  }

  private countGlobal(scope: PolicyScope): void {
    const feature = scope === 'ip' ? 'globalIpBanCount' : scope === 'account' ? 'globalAccountBanCount' : null;
    if (feature === null) return;
    const rule = this.rule(feature, 'global');
    if (rule === null) return;
    this.addCount('global', 'server', feature, Math.max(1, Number(rule.config.recordValue ?? 1)));
  }

  private markReset(scope: PolicyScope, target: string, now: number): void {
    this.db.prepare('INSERT INTO security_policy_resets (scope, target, reset_at) VALUES (?, ?, ?) ON CONFLICT(scope, target) DO UPDATE SET reset_at = excluded.reset_at').run(scope, target, now);
  }

  private insert(scope: PolicyScope, target: string, feature: string, until: number, now: number): SecurityBan {
    const result = this.db.prepare(
      'INSERT INTO security_bans (scope, target, feature, until, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(scope, target, feature, until, now);
    return { id: Number(result.lastInsertRowid), scope, target, feature, until, createdAt: now };
  }

  private clearFeatureBans(scope: PolicyScope, target: string): void {
    this.db.prepare("DELETE FROM security_bans WHERE scope = ? AND target = ? AND feature != 'global'").run(scope, target);
  }

  resetAt(scope: PolicyScope, target: string): number {
    const row = this.db.prepare('SELECT reset_at FROM security_policy_resets WHERE scope = ? AND target = ?').get(scope, target) as { reset_at: number } | undefined;
    return row?.reset_at ?? 0;
  }

  clearAll(): number {
    const now = this.now();
    return this.db.transaction(() => {
      const targets = this.db.prepare('SELECT DISTINCT scope, target FROM security_bans').all() as Array<{ scope: PolicyScope; target: string }>;
      const removed = this.db.prepare('DELETE FROM security_bans').run().changes;
      const markReset = this.db.prepare('INSERT INTO security_policy_resets (scope, target, reset_at) VALUES (?, ?, ?) ON CONFLICT(scope, target) DO UPDATE SET reset_at = excluded.reset_at');
      for (const target of targets) markReset.run(target.scope, target.target, now);
      const users = this.db.prepare('SELECT id FROM users').all() as Array<{ id: number }>;
      for (const user of users) markReset.run('account', String(user.id), now);
      const ips = this.db.prepare("SELECT DISTINCT ip FROM audit_logs WHERE ip IS NOT NULL AND ip != '' UNION SELECT DISTINCT ip FROM sessions WHERE ip IS NOT NULL AND ip != ''").all() as Array<{ ip: string }>;
      for (const ip of ips) markReset.run('ip', ip.ip, now);
      this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, rename_limited_until = NULL').run();
      this.db.prepare('DELETE FROM security_policy_counts').run();
      return removed;
    })();
  }

  clear(id: number): void {
    const row = this.db.prepare('SELECT scope, target, feature FROM security_bans WHERE id = ?').get(id) as { scope: PolicyScope; target: string; feature: string } | undefined;
    this.db.prepare('DELETE FROM security_bans WHERE id = ?').run(id);
    if (!row) return;
    const now = this.now();
    // Clearing any policy ban is an explicit reset for that target. Without
    // this, the old audit/session/IP counters immediately recreate the ban.
    this.db.prepare('INSERT INTO security_policy_resets (scope, target, reset_at) VALUES (?, ?, ?) ON CONFLICT(scope, target) DO UPDATE SET reset_at = excluded.reset_at').run(row.scope, row.target, now);
    if (row.scope === 'account') {
      const userId = Number(row.target);
      if (Number.isSafeInteger(userId)) {
        if (row.feature === 'global' || row.feature === 'loginFailure') {
          this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
        }
        if (row.feature === 'global' || row.feature === 'renameLimit') {
          this.db.prepare('UPDATE users SET rename_limited_until = NULL WHERE id = ?').run(userId);
        }
      }
    }
  }

  clearTarget(scope: PolicyScope, target: string): void {
    this.db.prepare('DELETE FROM security_bans WHERE scope = ? AND target = ?').run(scope, target);
  }
}
