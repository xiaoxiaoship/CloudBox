import type { AuditService } from '../auditService.ts';
import { getRecentLogs } from '../../../shared/logger.ts';

export interface AdminLogView {
  runtime: string[];
  audit: unknown[];
}

/** Shared log view for Electron IPC and the headless admin HTTP adapter. */
export function getAdminLogView(audit: AuditService, limit = 200): AdminLogView {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  return {
    runtime: getRecentLogs(safeLimit),
    audit: audit.list({ limit: safeLimit }),
  };
}
