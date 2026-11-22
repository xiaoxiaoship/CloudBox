import type { RequestHandler } from 'express';
import type { AuditService } from '../../core/services/auditService.ts';
import type { PublicUser } from '../../core/types/models.ts';
import { getRequestId } from '../../server/middleware/requestId.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SENSITIVE_KEY = /pass|token|secret|content|api[_-]?key|private/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
  }
  return output;
}

/** Audit every authenticated/asynchronous admin write without duplicating mail-event delivery. */
export function createAdminWriteAudit(audit: AuditService): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    res.on('finish', () => {
      if (req.path === '/auth/login' || req.path === '/setup') return;
      const user = res.locals.adminUser as PublicUser | undefined;
      audit.record({
        actorType: 'admin',
        actorId: user?.id ?? null,
        action: `admin.write.${req.method.toLowerCase()}`,
        result: res.statusCode >= 200 && res.statusCode < 400 ? 'success' : 'denied',
        targetType: 'admin-api',
        targetPath: req.originalUrl,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        requestId: getRequestId(res),
        detail: {
          method: req.method,
          status: res.statusCode,
          body: sanitize(req.body),
        },
      });
    });
    next();
  };
}
