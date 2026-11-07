import type { Request, Response } from 'express';
import type { RequestContext } from '../../core/services/fileService.ts';

/** 汇总审计需要的请求上下文 */
export function requestContext(req: Request, res: Response): RequestContext {
  const requestId = res.locals.requestId;
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: typeof requestId === 'string' ? requestId : null,
  };
}
