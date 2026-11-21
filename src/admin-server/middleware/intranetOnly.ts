import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import type { SettingsService } from '../../core/services/settingsService.ts';
import type { AuditService } from '../../core/services/auditService.ts';
import { getRequestId } from '../../server/middleware/requestId.ts';

function normalizeIp(value: string | undefined): string {
  if (!value) return '';
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value;
  return mapped === '0:0:0:0:0:0:0:1' ? '::1' : mapped;
}

export function isPrivateAddress(value: string | undefined): boolean {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (ip === '::1' || ip === '127.0.0.1') return true;

  if (isIP(ip) === 4) {
    const parts = ip.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    const [a = -1, b = -1] = parts;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 127
    );
  }

  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    );
  }

  return false;
}

/**
 * 管理 Web 默认仅允许内网与 loopback。直接读取 socket 地址，不信任 XFF，
 * 避免反向代理/伪造头把公网请求伪装成内网。
 */
export function createIntranetOnly(settings: SettingsService, audit?: AuditService): RequestHandler {
  return (req, res, next) => {
    if (!settings.get('adminWeb.intranetOnly')) {
      next();
      return;
    }

    const remote = normalizeIp(req.socket.remoteAddress);
    if (isPrivateAddress(remote)) {
      next();
      return;
    }

    audit?.record({
      actorType: 'system',
      action: 'security.admin.intranet_reject',
      result: 'denied',
      targetType: 'request',
      targetPath: req.originalUrl,
      ip: remote,
      userAgent: req.get('user-agent') ?? null,
      requestId: getRequestId(res),
    });

    res.status(403).json({
      code: 'ADMIN_INTRANET_ONLY',
      message: '管理端仅允许内网访问',
      requestId: getRequestId(res),
    });
  };
}
