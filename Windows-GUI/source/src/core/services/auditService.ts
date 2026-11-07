import type { AuditRepository } from '../db/repositories/auditRepo.ts';
import type {
  AuditActorType,
  AuditLogRecord,
  AuditResult,
} from '../types/models.ts';

const MAX_DETAIL_LENGTH = 4_096;

export interface AuditEvent {
  actorType: AuditActorType;
  actorId?: number | null;
  action: string;
  result: AuditResult;
  targetType?: string | null;
  targetId?: string | null;
  targetPath?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** 会被序列化为 JSON 并截断，禁止塞入密码/令牌等敏感值 */
  detail?: unknown;
}

function serializeDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;

  try {
    const text = JSON.stringify(detail);
    return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
  } catch {
    return null;
  }
}

/** 审计服务：统一补齐时间戳与空字段，业务层只描述"发生了什么" */
export class AuditService {
  private readonly repo: AuditRepository;
  private readonly now: () => number;

  constructor(repo: AuditRepository, now: () => number = Date.now) {
    this.repo = repo;
    this.now = now;
  }

  record(event: AuditEvent): number {
    return this.repo.insert({
      ts: this.now(),
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      targetPath: event.targetPath ?? null,
      result: event.result,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
      detail: serializeDetail(event.detail),
    });
  }

  list(options: { limit?: number; offset?: number } = {}): AuditLogRecord[] {
    return this.repo.list(options);
  }
}
