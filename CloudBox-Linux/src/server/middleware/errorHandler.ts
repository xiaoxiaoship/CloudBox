import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { EventBus } from '../../core/services/eventBus.ts';
import { PathSecurityError } from '../../core/security/safePath.ts';
import { AuthError } from '../../core/services/authService.ts';
import { FileServiceError } from '../../core/services/fileService.ts';
import { RegistrationError } from '../../core/services/registrationService.ts';
import { ShareError } from '../../core/services/shareService.ts';
import { logger } from '../../shared/logger.ts';
import { UploadError } from '../upload/receiveUpload.ts';
import { CsrfError } from './csrf.ts';
import { getRequestId } from './requestId.ts';

interface ErrorBody {
  code: string;
  message: string;
  requestId: string | null;
  details?: unknown;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ErrorBody = {
    code: 'NOT_FOUND',
    message: '接口不存在',
    requestId: getRequestId(res),
  };
  res.status(404).json(body);
};

/**
 * 统一错误出口：对外只暴露稳定错误码与安全文案，内部细节只进日志。
 * Express 5 会自动把 async 抛出的错误交到这里。
 */
export function errorHandler(events?: EventBus): ErrorRequestHandler {
  return (error, req, res, _next) => {
  const requestId = getRequestId(res);

  if (res.headersSent) {
    res.destroy();
    return;
  }

  if (error instanceof AuthError) {
    if (error.code === 'AUTH_ACCOUNT_LOCKED') {
      events?.emit('security.alert', {
        ip: req.ip ?? null,
        endpoint: req.path,
        reason: 'account_locked',
      });
    }
    if (error.retryAfterMs !== undefined) {
      res.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1_000)));
    }
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof PathSecurityError) {
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof FileServiceError) {
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
      ...(error.details === undefined ? {} : { details: error.details }),
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof ShareError) {
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof RegistrationError) {
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof UploadError) {
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof CsrfError) {
    res.status(error.httpStatus).json({
      code: error.code,
      message: error.message,
      requestId,
    } satisfies ErrorBody);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '请求参数不合法',
      requestId,
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    } satisfies ErrorBody);
    return;
  }

  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ code: 'INVALID_JSON', message: '请求体不是合法 JSON', requestId });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: '请求体过大', requestId });
    return;
  }

  events?.emit('system.error', {
    requestId,
    message: error instanceof Error ? error.message : String(error),
    endpoint: req.path,
  });
  logger.error('未处理的服务端异常', {
    requestId,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
  });

  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    requestId,
  } satisfies ErrorBody);
  };
}
