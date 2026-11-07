import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { DownloadTarget } from '../../core/services/fileService.ts';
import { buildAttachmentDisposition, buildInlineDisposition } from './contentDisposition.ts';
import { parseRangeHeader } from './range.ts';

/**
 * 流式发送下载响应：
 *  - 全程 createReadStream -> pipeline -> res，文件不会整体进入内存
 *  - 支持单段 Range（断点续传 / 播放器拖动）
 *  - 强制 Content-Disposition: attachment，避免浏览器内联执行用户内容
 */
export async function sendDownload(
  req: Request,
  res: Response,
  target: DownloadTarget,
): Promise<void> {
  const parsed = parseRangeHeader(req.headers.range, target.size);

  if (parsed.type === 'invalid') {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${target.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.end();
    return;
  }

  const start = parsed.type === 'range' ? parsed.range.start : 0;
  const end = parsed.type === 'range' ? parsed.range.end : target.size - 1;
  const length = target.size === 0 ? 0 : end - start + 1;

  res.status(parsed.type === 'range' ? 206 : 200);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', buildAttachmentDisposition(target.name));
  res.setHeader('Content-Length', String(length));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (parsed.type === 'range') {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${target.size}`);
  }

  if (target.size === 0) {
    res.end();
    return;
  }

  try {
    // 客户端中途断开时 pipeline 会抛 ERR_STREAM_PREMATURE_CLOSE，属正常情况
    await pipeline(createReadStream(target.absolutePath, { start, end }), res);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed) return;
    if (!res.headersSent) throw error;
    res.destroy();
  }
}

/**
 * 预览用内联响应：Content-Type 来自服务端白名单，禁止嗅探，
 * 并通过 CSP sandbox 确保即使内容被误判为文档也无法执行脚本。
 * 支持单段 Range，HTML5 <video> 可拖动进度并按需取流。
 */
export async function sendInline(
  req: Request,
  res: Response,
  target: DownloadTarget,
  mime: string,
): Promise<void> {
  const parsed = parseRangeHeader(req.headers.range, target.size);

  if (parsed.type === 'invalid') {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${target.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.end();
    return;
  }

  const start = parsed.type === 'range' ? parsed.range.start : 0;
  const end = parsed.type === 'range' ? parsed.range.end : target.size - 1;
  const length = target.size === 0 ? 0 : end - start + 1;

  res.status(parsed.type === 'range' ? 206 : 200);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', buildInlineDisposition(target.name));
  res.setHeader('Content-Length', String(length));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');

  if (parsed.type === 'range') {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${target.size}`);
  }

  if (target.size === 0) {
    res.end();
    return;
  }

  try {
    await pipeline(createReadStream(target.absolutePath, { start, end }), res);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed) return;
    if (!res.headersSent) throw error;
    res.destroy();
  }
}
