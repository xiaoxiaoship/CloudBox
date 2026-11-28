import type { Request } from 'express';
import type { RequestOrigin } from '../../core/services/hostingService.ts';

/**
 * 取当前请求的协议与 Host，用于生成内网可访问的绝对地址。
 * 端口来自 Host 头，不硬编码；信任代理时 req.protocol 由 Express 按设置解析。
 */
export function requestOrigin(req: Request): RequestOrigin | null {
  const host = req.get('host');
  if (!host) return null;
  return {
    protocol: req.protocol === 'https' ? 'https' : 'http',
    host,
  };
}
