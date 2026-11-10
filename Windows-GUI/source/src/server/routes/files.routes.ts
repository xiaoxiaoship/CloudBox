import { unlink } from 'node:fs/promises';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import { FILE_ERROR, FileServiceError } from '../../core/services/fileService.ts';
import { sendDownload, sendInline } from '../http/download.ts';
import { requestContext } from '../http/context.ts';
import { receiveUpload, UploadError } from '../upload/receiveUpload.ts';
import { recordUploadBytes } from '../traffic.ts';

const listQuery = z.object({
  path: z.string().max(900).optional().default(''),
});

const folderBody = z.object({
  path: z.string().max(900).optional().default(''),
  name: z.string().min(1).max(255),
});

const renameBody = z.object({
  path: z.string().min(1).max(900),
  newName: z.string().min(1).max(255),
});

const deleteBody = z.object({
  paths: z.array(z.string().min(1).max(900)).min(1).max(100),
});

const transferBody = z.object({
  paths: z.array(z.string().min(1).max(900)).min(1).max(100),
  destination: z.string().max(900).optional().default(''),
});

const downloadQuery = z.object({
  path: z.string().min(1).max(900),
});

const previewQuery = z.object({
  path: z.string().min(1).max(900),
});

const extractBody = z.object({
  file_path: z.string().min(1).max(900),
  target_dir: z.string().max(900).optional().default(''),
});

const scanBody = z.object({
  path: z.string().min(1).max(900),
});

const uploadQuery = z.object({
  path: z.string().max(900).optional().default(''),
  overwrite: z.string().optional(),
});

/** 这些错误由路由层补记 denied 审计（路径/名称类错误已由 FileService 记录） */
const UPLOAD_AUDIT_CODES = new Set<string>([
  FILE_ERROR.QUOTA_EXCEEDED,
  FILE_ERROR.EXISTS,
  FILE_ERROR.TARGET_IS_DIRECTORY,
  FILE_ERROR.FILE_TOO_LARGE,
  FILE_ERROR.RENAME_FAILED,
]);

function shouldAuditUploadError(error: unknown): boolean {
  if (error instanceof UploadError) return true;
  if (error instanceof FileServiceError) return UPLOAD_AUDIT_CODES.has(error.code);
  return false;
}

export interface FilesRouterDeps {
  csrf: RequestHandler;
  uploadLimiter: RequestHandler;
  extractLimiter: RequestHandler;
  scanLimiter: RequestHandler;
}

export function createFilesRouter(services: CoreServices, deps: FilesRouterDeps): Router {
  const router = Router();

  router.get('/usage', (req, res) => {
    res.json(services.files.getUsage(req.user!));
  });

  router.get('/', async (req, res) => {
    const { path } = listQuery.parse(req.query);
    const listing = await services.files.list(req.user!, path, requestContext(req, res));
    res.json(listing);
  });

  router.get('/download', async (req, res) => {
    const { path } = downloadQuery.parse(req.query);
    const target = await services.files.openDownload(req.user!, path, requestContext(req, res));
    await sendDownload(req, res, target);
  });

  router.get('/preview/info', async (req, res) => {
    const { path } = previewQuery.parse(req.query);
    const info = await services.files.getPreviewInfo(
      req.user!,
      path,
      requestContext(req, res),
    );
    res.json(info);
  });

  router.get('/preview/content', async (req, res) => {
    const { path } = previewQuery.parse(req.query);
    const preview = await services.files.openPreview(
      req.user!,
      path,
      requestContext(req, res),
    );

    if (preview.kind === 'text') {
      res.json({
        kind: 'text',
        text: preview.text,
        encoding: preview.encoding,
        truncated: preview.truncated,
        size: preview.size,
      });
      return;
    }

    await sendInline(req, res, preview.target, preview.mime);
  });

  router.post('/extract', deps.extractLimiter, deps.csrf, async (req, res) => {
    const body = extractBody.parse(req.body);
    const result = await services.extraction.start(
      req.user!,
      body.file_path,
      body.target_dir,
      requestContext(req, res),
    );
    res.status(202).json(result);
  });

  router.post('/scan', deps.scanLimiter, deps.csrf, async (req, res) => {
    const body = scanBody.parse(req.body);
    const result = await services.scan.start(
      req.user!,
      body.path,
      requestContext(req, res),
    );
    res.status(202).json(result);
  });

  router.post('/folder', deps.csrf, async (req, res) => {    const body = folderBody.parse(req.body);
    const entry = await services.files.createFolder(
      req.user!,
      body.path,
      body.name,
      requestContext(req, res),
    );
    res.status(201).json({ entry });
  });

  router.patch('/', deps.csrf, async (req, res) => {
    const body = renameBody.parse(req.body);
    const entry = await services.files.rename(
      req.user!,
      body.path,
      body.newName,
      requestContext(req, res),
    );
    res.json({ entry });
  });

  router.delete('/', deps.csrf, async (req, res) => {
    const body = deleteBody.parse(req.body);
    const result = await services.files.remove(req.user!, body.paths, requestContext(req, res));
    res.json({ ...result, usage: services.files.getUsage(req.user!) });
  });

  router.post('/copy', deps.csrf, async (req, res) => {
    const body = transferBody.parse(req.body);
    const result = await services.files.copy(
      req.user!,
      body.paths,
      body.destination,
      requestContext(req, res),
    );
    res.json({ ...result, usage: services.files.getUsage(req.user!) });
  });

  router.post('/move', deps.csrf, async (req, res) => {
    const body = transferBody.parse(req.body);
    const result = await services.files.move(
      req.user!,
      body.paths,
      body.destination,
      requestContext(req, res),
    );
    res.json({ ...result, usage: services.files.getUsage(req.user!) });
  });

  router.post('/upload', deps.uploadLimiter, deps.csrf, async (req, res) => {
    const user = req.user!;
    const query = uploadQuery.parse(req.query);
    const overwrite = query.overwrite === '1' || query.overwrite === 'true';
    const ctx = requestContext(req, res);

    let preparedPath = query.path;

    try {
      const result = await services.files.runExclusive(user.id, async () => {
        const received = await receiveUpload(req, {
          tempDir: services.files.getTempDir(),
          onProgress: recordUploadBytes,
          prepare: (filename) => {
            const prepared = services.files.prepareUpload(
              user,
              query.path,
              filename,
              overwrite,
              ctx,
            );
            preparedPath = prepared.relativePath;
            return prepared;
          },
        });

        try {
          const file = await services.files.commitUpload(
            user,
            received.prepared,
            received.tempPath,
            received.size,
            ctx,
          );
          return {
            file,
            usage: services.files.getUsage(user),
            overwritten: received.prepared.existingSize > 0,
          };
        } finally {
          await unlink(received.tempPath).catch(() => {});
        }
      });

      res.status(result.overwritten ? 200 : 201).json({
        file: result.file,
        usage: result.usage,
      });
    } catch (error) {
      if (shouldAuditUploadError(error)) {
        services.files.auditUploadFailure(user, preparedPath, error, ctx);
      }
      throw error;
    }
  });

  return router;
}
