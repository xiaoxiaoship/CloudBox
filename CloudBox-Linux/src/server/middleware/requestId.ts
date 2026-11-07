import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** 为每个请求分配可追踪的 requestId，并回写响应头，便于审计与日志串联 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/** 从 res.locals 读取 requestId（避免各处重复 as string） */
export function getRequestId(res: { locals: Record<string, unknown> }): string | null {
  const value = res.locals.requestId;
  return typeof value === 'string' ? value : null;
}
