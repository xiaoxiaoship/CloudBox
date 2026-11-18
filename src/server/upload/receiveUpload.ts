import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import type { Request } from 'express';
import type { PreparedUpload } from '../../core/services/fileService.ts';

/** 上传阶段的 HTTP 错误（与领域层的 FileServiceError 区分开） */
export class UploadError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class UploadLimitError extends UploadError {
  readonly limitType: 'QUOTA_EXCEEDED' | 'FILE_TOO_LARGE';

  constructor(limitType: 'QUOTA_EXCEEDED' | 'FILE_TOO_LARGE') {
    super(
      limitType === 'QUOTA_EXCEEDED' ? 'UPLOAD_QUOTA_EXCEEDED' : 'UPLOAD_FILE_TOO_LARGE',
      limitType === 'QUOTA_EXCEEDED' ? '上传已超出可用配额，已中断' : '文件超出允许的大小',
      413,
    );
    this.name = 'UploadLimitError';
    this.limitType = limitType;
  }
}

export interface ReceiveUploadOptions {
  tempDir: string;
  /** 同步预检：拿到 filename 后立刻返回配额上限，流式写入时超限即断 */
  prepare: (filename: string) => PreparedUpload;
  onProgress?: (bytes: number) => void;
}

export interface ReceivedUpload {
  tempPath: string;
  size: number;
  filename: string;
  prepared: PreparedUpload;
}

/** 预检失败时最多继续丢弃这么多请求体，避免恶意客户端用超大文件拖住服务 */
const MAX_DRAIN_BYTES = 16 * 1024 * 1024;

function drainRequest(req: Request): Promise<void> {
  if (req.readableEnded || req.complete) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let done = false;
    let drained = 0;

    const finish = (): void => {
      if (done) return;
      done = true;
      req.off('data', onData);
      req.off('end', finish);
      req.off('close', finish);
      req.off('error', finish);
      resolve();
    };

    const onData = (chunk: Buffer): void => {
      drained += chunk.length;
      if (drained > MAX_DRAIN_BYTES) {
        req.destroy();
        finish();
      }
    };

    req.on('data', onData);
    req.once('end', finish);
    req.once('close', finish);
    req.once('error', finish);
    req.resume();
  });
}

function normalizePipelineError(error: unknown): UploadError {
  if (error instanceof UploadError) return error;

  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ERR_STREAM_PREMATURE_CLOSE') {
    return new UploadError('UPLOAD_ABORTED', '上传已中断', 400);
  }
  return new UploadError('UPLOAD_WRITE_FAILED', '写入临时文件失败', 500);
}

/**
 * 接收单个 multipart 文件：
 *   1. 拿到 filename 后同步预检（目标路径、配额、大小上限）
 *   2. 流式写入临时文件，Transform 边写边计数，超限立即 destroy 管道
 *   3. 失败/中断自动清理临时文件
 *
 * 注意：本函数不负责更新配额与 rename，交由 FileService.commitUpload 在用户锁内完成。
 */
export async function receiveUpload(
  req: Request,
  options: ReceiveUploadOptions,
): Promise<ReceivedUpload> {
  let parser: Busboy.Busboy;
  try {
    parser = Busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { files: 1, fields: 4, parts: 6 },
    });
  } catch {
    throw new UploadError('UPLOAD_INVALID_MULTIPART', '请求不是合法的 multipart/form-data', 400);
  }

  return await new Promise<ReceivedUpload>((resolve, reject) => {
    let settled = false;
    let fileSeen = false;
    let tempPath: string | null = null;
    let size = 0;
    let filename = '';
    let prepared: PreparedUpload | null = null;
    let pipelineDone: Promise<void> | null = null;

    const cleanupTemp = (): void => {
      if (tempPath === null) return;
      const target = tempPath;
      tempPath = null;
      void unlink(target).catch(() => {});
    };

    const fail = (error: unknown, drain = false): void => {
      if (settled) return;
      settled = true;
      cleanupTemp();

      if (!drain) {
        reject(error);
        return;
      }

      req.unpipe(parser);
      parser.destroy();
      void drainRequest(req).finally(() => reject(error));
    };

    parser.on('file', (fieldName, stream, info) => {
      // busboy 在 parser.destroy()/客户端中断时会让 file stream 发 error；
      // 必须始终有监听器，否则会变成 uncaughtException
      stream.on('error', () => {});

      if (settled) {
        stream.resume();
        return;
      }
      if (fieldName !== 'file') {
        stream.resume();
        fail(new UploadError('UPLOAD_INVALID_FIELD', '文件字段名必须为 file', 400), true);
        return;
      }
      if (fileSeen) {
        stream.resume();
        fail(new UploadError('UPLOAD_TOO_MANY_FILES', '一次只能上传一个文件', 400), true);
        return;
      }

      fileSeen = true;
      filename = info.filename ?? '';

      try {
        prepared = options.prepare(filename);
      } catch (error) {
        // 配额不足 / 重名 / 非法路径：丢弃剩余请求体后再回复，避免连接被重置
        stream.resume();
        fail(error, true);
        return;
      }

      const current = prepared;
      const targetTemp = path.join(options.tempDir, `${randomUUID()}.part`);
      tempPath = targetTemp;

      const out = createWriteStream(targetTemp, { flags: 'wx' });
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          options.onProgress?.(chunk.length);
          if (size > current.limitBytes) {
            const limitType =
              current.maxFileBytes <= current.remainingBytes ? 'FILE_TOO_LARGE' : 'QUOTA_EXCEEDED';
            callback(new UploadLimitError(limitType));
            return;
          }
          callback(null, chunk);
        },
      });

      pipelineDone = pipeline(stream, limiter, out);
      void pipelineDone.catch((error: unknown) => fail(normalizePipelineError(error), true));
    });

    parser.once('filesLimit', () =>
      fail(new UploadError('UPLOAD_TOO_MANY_FILES', '一次只能上传一个文件', 400), true),
    );
    parser.once('fieldsLimit', () =>
      fail(new UploadError('UPLOAD_TOO_MANY_FIELDS', '表单字段过多', 400), true),
    );
    parser.once('partsLimit', () =>
      fail(new UploadError('UPLOAD_TOO_MANY_PARTS', '表单内容过多', 400), true),
    );
    parser.once('error', () =>
      fail(new UploadError('UPLOAD_INVALID_MULTIPART', '无法解析上传内容', 400)),
    );

    parser.once('close', () => {
      if (settled) return;

      if (!fileSeen || prepared === null || tempPath === null || pipelineDone === null) {
        fail(new UploadError('UPLOAD_NO_FILE', '未收到文件', 400));
        return;
      }

      const finalTempPath = tempPath;
      const finalPrepared = prepared;

      void pipelineDone
        .then(() => {
          if (settled) return;
          settled = true;
          resolve({ tempPath: finalTempPath, size, filename, prepared: finalPrepared });
        })
        .catch((error: unknown) => fail(error));
    });

    req.once('aborted', () => fail(new UploadError('UPLOAD_ABORTED', '上传已中断', 400)));
    req.once('error', () => fail(new UploadError('UPLOAD_ABORTED', '上传已中断', 400)));
    req.once('close', () => {
      if (!req.complete) fail(new UploadError('UPLOAD_ABORTED', '上传已中断', 400));
    });

    req.pipe(parser);
  });
}
