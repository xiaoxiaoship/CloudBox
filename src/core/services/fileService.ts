import { lstatSync } from 'node:fs';
import { appendFile, cp, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { detect as detectEncoding } from 'chardet';
import iconv from 'iconv-lite';
import type { Db } from '../db/connection.ts';
import type { QuotaRepository } from '../db/repositories/quotaRepo.ts';
import type { ScanRepository } from '../db/repositories/scanRepo.ts';
import {
  normalizeRelativePath,
  PathSecurityError,
  PATH_ERROR,
  resolveUserPath,
  type ResolvedUserPath,
} from '../security/safePath.ts';
import type { SessionUser } from '../types/models.ts';
import type { AuditService } from './auditService.ts';
import type { EventBus } from './eventBus.ts';
import type { SettingsService } from './settingsService.ts';
import { KeyedMutex } from '../fs/keyedMutex.ts';

export const FILE_ERROR = {
  INVALID_NAME: 'FILE_INVALID_NAME',
  INVALID_OPERATION: 'FILE_INVALID_OPERATION',
  EXISTS: 'FILE_EXISTS',
  TARGET_IS_DIRECTORY: 'FILE_TARGET_IS_DIRECTORY',
  TOO_MANY_PATHS: 'FILE_TOO_MANY_PATHS',
  QUOTA_EXCEEDED: 'FILE_QUOTA_EXCEEDED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  RENAME_FAILED: 'FILE_RENAME_FAILED',
  COPY_FAILED: 'FILE_COPY_FAILED',
  PREVIEW_UNSUPPORTED: 'PREVIEW_UNSUPPORTED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  FILE_INFECTED: 'FILE_INFECTED',
} as const;

export type FileErrorCode = (typeof FILE_ERROR)[keyof typeof FILE_ERROR];

/** 路由/服务共用的细粒度权限 403 */
export function assertFeature(
  settings: SettingsService,
  key:
    | 'allow_user_preview_image'
    | 'allow_user_preview_video'
    | 'allow_user_preview_pdf'
    | 'allow_user_preview_office'
    | 'allow_user_extract'
    | 'allow_user_scan',
  message: string,
): void {
  if (!settings.get(key)) {
    throw new FileServiceError(FILE_ERROR.FEATURE_DISABLED, message, 403);
  }
}

export class FileServiceError extends Error {
  readonly code: FileErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: FileErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FileServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** 离线管理端代操作时，审计应记为管理员而非目标用户 */
  actor?: { type: 'admin' | 'user'; id: number };
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number | null;
  modifiedAt: number;
}

export interface FileListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
}

export interface UsageInfo {
  quotaBytes: number | null;
  usedBytes: number;
  availableBytes: number | null;
}

export interface DownloadTarget {
  absolutePath: string;
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'text' | 'pdf' | 'office';

export interface PreviewInfo {
  kind: PreviewKind | 'none';
  mime: string | null;
  size: number;
  name: string;
  path: string;
}

export interface PreviewTextResult {
  kind: 'text';
  text: string;
  encoding: string;
  truncated: boolean;
  size: number;
}

export interface PreviewBinaryResult {
  kind: 'image' | 'pdf' | 'video' | 'audio' | 'office';
  target: DownloadTarget;
  mime: string;
}

export type PreviewContentResult = PreviewTextResult | PreviewBinaryResult;

export interface PreparedUpload {
  dir: string;
  filename: string;
  relativePath: string;
  absolutePath: string;
  existingSize: number;
  overwrite: boolean;
  quotaBytes: number | null;
  usedBytes: number;
  /** 配额剩余可用字节（含覆盖文件可回收的空间）；不限量时为 Infinity */
  remainingBytes: number;
  maxFileBytes: number;
  /** 本次上传允许的最大字节数 = min(remainingBytes, maxFileBytes) */
  limitBytes: number;
}

export interface FileServiceOptions {
  db: Db;
  storageRoot: string;
  tempDir: string;
  quotas: QuotaRepository;
  scans: ScanRepository;
  settings: SettingsService;
  audit: AuditService;
  events?: EventBus;
  now?: () => number;
}

const MAX_LIST_ENTRIES = 5_000;
const MAX_DELETE_PATHS = 100;
const TEXT_PREVIEW_LIMIT_BYTES = 512 * 1024;
const SNIFF_BYTES = 4_100;

/** 只允许浏览器安全内联显示的图片格式；SVG 明确不在白名单 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** 视频预览白名单；只允许这三种容器，并以对应 MIME 内联发送 */
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
};

/** OOXML 文件：客户端用 docx-preview / xlsx / pptx-preview 渲染。 */
const OFFICE_MIME_BY_EXT: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
};

/** 文本预览白名单：HTML / SVG / XHTML 等主动内容一律排除，只能下载 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'csv',
  'yml', 'yaml', 'ini', 'conf', 'cfg', 'toml', 'xml',
  'ts', 'tsx', 'js', 'jsx', 'css', 'scss',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'sql', 'sh',
]);

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Windows 上杀软/索引器可能短暂占用文件，rename 失败时重试几次 */
async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      if (!retryable || attempt >= 3) throw error;
      await delay(40 * (attempt + 1));
    }
  }
}

/** 递归统计目录内普通文件字节数（跳过符号链接），用于删除目录时回退配额 */
async function measureDirectorySize(directory: string): Promise<number> {
  let total = 0;
  const stack: string[] = [directory];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const dirents = await readdir(current, { withFileTypes: true });

    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const absolute = path.join(current, dirent.name);

      if (dirent.isDirectory()) {
        stack.push(absolute);
      } else if (dirent.isFile()) {
        total += (await lstat(absolute)).size;
      }
    }
  }

  return total;
}

/**
 * 文本解码策略：
 *  1. UTF-8 BOM 直接按 UTF-8
 *  2. 严格 UTF-8 校验通过即 UTF-8（避免 chardet 把纯 ASCII/UTF-8 误判为单字节编码）
 *  3. 失败后交给 chardet 猜测，再用 iconv-lite 解码
 *  4. 仍失败则回退 UTF-8
 */
function decodeTextBuffer(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'UTF-8' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text, encoding: 'UTF-8' };
  } catch {
    // 不是合法 UTF-8，继续探测
  }

  const encoding = detectEncoding(buffer) ?? 'UTF-8';
  try {
    return { text: iconv.decode(buffer, encoding), encoding };
  } catch {
    return { text: buffer.toString('utf8'), encoding: 'UTF-8' };
  }
}

async function readPrefix(filePath: string, length: number): Promise<Buffer> {  if (length <= 0) return Buffer.alloc(0);

  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function parentOf(relativePath: string): string | null {  if (relativePath === '') return null;
  const segments = relativePath.split('/');
  segments.pop();
  return segments.join('/');
}

function entryOf(relativePath: string, name: string, info: { size: number; mtimeMs: number; isDirectory(): boolean }): FileEntry {
  return {
    name,
    path: relativePath,
    type: info.isDirectory() ? 'dir' : 'file',
    size: info.isDirectory() ? null : info.size,
    modifiedAt: Math.trunc(info.mtimeMs),
  };
}

/**
 * 文件领域服务。
 *
 * 约定：
 *  - 所有路径都必须经过 resolveUserPath，服务内部不存在任何字符串拼接文件路径后直接操作的情况
 *  - 所有改变用量的操作都持有用户级互斥锁
 *  - 上传采用"临时文件 + 原子 rename"，临时文件由调用方（HTTP 层）在 finally 中清理
 */
export class FileService {
  private readonly db: Db;
  private readonly storageRoot: string;
  private readonly tempDir: string;
  private readonly quotas: QuotaRepository;
  private readonly scans: ScanRepository;
  private readonly settings: SettingsService;
  private readonly audit: AuditService;
  private readonly events: EventBus | null;
  private readonly now: () => number;
  private readonly mutex = new KeyedMutex();

  constructor(options: FileServiceOptions) {
    this.db = options.db;
    this.storageRoot = options.storageRoot;
    this.tempDir = options.tempDir;
    this.quotas = options.quotas;
    this.scans = options.scans;
    this.settings = options.settings;
    this.audit = options.audit;
    this.events = options.events ?? null;
    this.now = options.now ?? Date.now;
  }

  getTempDir(): string {
    return this.tempDir;
  }

  runExclusive<T>(userId: number, task: () => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(userId, task);
  }

  async list(user: SessionUser, relativePath: string, ctx: RequestContext): Promise<FileListing> {
    const resolved = this.resolve(user, relativePath, { expect: 'dir' }, 'file.list', ctx);
    const dirents = await readdir(resolved.absolutePath, { withFileTypes: true });

    const entries: FileEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;

      const absolute = path.join(resolved.absolutePath, dirent.name);
      let info;
      try {
        info = await lstat(absolute);
      } catch {
        continue; // 目录在遍历期间被删除
      }
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) continue;

      const childRelative =
        resolved.relativePath === '' ? dirent.name : `${resolved.relativePath}/${dirent.name}`;
      entries.push(entryOf(childRelative, dirent.name, info));
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    const truncated = entries.length > MAX_LIST_ENTRIES;
    return {
      path: resolved.relativePath,
      parent: parentOf(resolved.relativePath),
      entries: truncated ? entries.slice(0, MAX_LIST_ENTRIES) : entries,
      truncated,
    };
  }

  async createFolder(
    user: SessionUser,
    parentPath: string,
    name: string,
    ctx: RequestContext,
  ): Promise<FileEntry> {
    const safeName = this.validateName(user, name, 'file.mkdir', ctx);

    return this.mutex.runExclusive(user.id, async () => {
      const parent = this.resolve(user, parentPath, { expect: 'dir' }, 'file.mkdir', ctx);
      const relative = parent.relativePath === '' ? safeName : `${parent.relativePath}/${safeName}`;
      const target = this.resolve(user, relative, { mustExist: false }, 'file.mkdir', ctx);

      try {
        await mkdir(target.absolutePath);
      } catch (error) {
        if (isErrno(error, 'EEXIST')) {
          throw new FileServiceError(FILE_ERROR.EXISTS, '同名文件或目录已存在', 409);
        }
        throw error;
      }

      const info = await lstat(target.absolutePath);
      this.auditSuccess(user, 'file.mkdir', relative, ctx);

      return entryOf(relative, safeName, info);
    });
  }

  async rename(
    user: SessionUser,
    relativePath: string,
    newName: string,
    ctx: RequestContext,
  ): Promise<FileEntry> {
    const safeName = this.validateName(user, newName, 'file.rename', ctx);

    return this.mutex.runExclusive(user.id, async () => {
      const source = this.resolve(user, relativePath, { expect: 'any' }, 'file.rename', ctx);
      if (source.relativePath === '') {
        throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '不能重命名根目录', 400);
      }

      const parent = parentOf(source.relativePath) ?? '';
      const targetRelative = parent === '' ? safeName : `${parent}/${safeName}`;

      if (targetRelative === source.relativePath) {
        const info = await lstat(source.absolutePath);
        return entryOf(source.relativePath, safeName, info);
      }

      const target = this.resolve(user, targetRelative, { mustExist: false }, 'file.rename', ctx);

      try {
        await lstat(target.absolutePath);
        throw new FileServiceError(FILE_ERROR.EXISTS, '目标名称已存在', 409);
      } catch (error) {
        if (error instanceof FileServiceError) throw error;
        if (!isErrno(error, 'ENOENT')) throw error;
      }

      await renameWithRetry(source.absolutePath, target.absolutePath);
      this.scans.clear(user.id, source.relativePath);
      this.scans.clear(user.id, targetRelative);
      const info = await lstat(target.absolutePath);
      this.auditSuccess(user, 'file.rename', source.relativePath, ctx, {
        newPath: targetRelative,
      });

      return entryOf(targetRelative, safeName, info);
    });
  }

  async copy(
    user: SessionUser,
    relativePaths: string[],
    destinationPath: string,
    ctx: RequestContext,
  ): Promise<{ entries: FileEntry[]; copiedBytes: number }> {
    return this.transfer(user, relativePaths, destinationPath, ctx, false);
  }

  async move(
    user: SessionUser,
    relativePaths: string[],
    destinationPath: string,
    ctx: RequestContext,
  ): Promise<{ entries: FileEntry[] }> {
    const result = await this.transfer(user, relativePaths, destinationPath, ctx, true);
    return { entries: result.entries };
  }

  private async transfer(
    user: SessionUser,
    relativePaths: string[],
    destinationPath: string,
    ctx: RequestContext,
    move: boolean,
  ): Promise<{ entries: FileEntry[]; copiedBytes: number }> {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '请至少选择一个文件或文件夹', 400);
    }
    if (relativePaths.length > MAX_DELETE_PATHS) {
      throw new FileServiceError(
        FILE_ERROR.TOO_MANY_PATHS,
        `一次最多操作 ${MAX_DELETE_PATHS} 个路径`,
        400,
      );
    }

    return this.mutex.runExclusive(user.id, async () => {
      const destination = this.resolve(
        user,
        destinationPath,
        { expect: 'dir' },
        move ? 'file.move' : 'file.copy',
        ctx,
      );
      const entries: FileEntry[] = [];
      let copiedBytes = 0;

      for (const relativePath of relativePaths) {
        if (relativePath === '') {
          throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '不能移动或复制根目录', 400);
        }

        const source = this.resolve(
          user,
          relativePath,
          { expect: 'any' },
          move ? 'file.move' : 'file.copy',
          ctx,
        );
        if (destination.relativePath === source.relativePath) {
          throw new FileServiceError(FILE_ERROR.EXISTS, '目标位置与源位置相同', 409);
        }
        if (
          destination.relativePath === source.relativePath ||
          destination.relativePath.startsWith(`${source.relativePath}/`)
        ) {
          throw new FileServiceError(
            FILE_ERROR.INVALID_OPERATION,
            '不能把文件夹移动或复制到自身内部',
            400,
          );
        }

        const name = path.basename(source.relativePath);
        const targetRelative =
          destination.relativePath === '' ? name : `${destination.relativePath}/${name}`;
        if (targetRelative === source.relativePath) {
          throw new FileServiceError(FILE_ERROR.EXISTS, '目标位置已存在同名文件或文件夹', 409);
        }

        const target = this.resolve(
          user,
          targetRelative,
          { mustExist: false },
          move ? 'file.move' : 'file.copy',
          ctx,
        );

        try {
          await lstat(target.absolutePath);
          throw new FileServiceError(FILE_ERROR.EXISTS, '目标位置已存在同名文件或文件夹', 409);
        } catch (error) {
          if (error instanceof FileServiceError) throw error;
          if (!isErrno(error, 'ENOENT')) throw error;
        }

        const sourceInfo = await lstat(source.absolutePath);
        const sourceBytes = sourceInfo.isDirectory()
          ? await measureDirectorySize(source.absolutePath)
          : sourceInfo.size;

        if (move) {
          try {
            await renameWithRetry(source.absolutePath, target.absolutePath);
          } catch (error) {
            throw new FileServiceError(
              FILE_ERROR.RENAME_FAILED,
              '移动失败，目标文件系统可能不支持跨盘移动',
              500,
              { cause: error instanceof Error ? error.message : String(error) },
            );
          }
          this.scans.clear(user.id, source.relativePath);
          this.scans.clear(user.id, targetRelative);
          this.auditSuccess(user, 'file.move', source.relativePath, ctx, {
            newPath: targetRelative,
            size: sourceBytes,
          });
        } else {
          try {
            this.assertQuota(user, sourceBytes);
            await cp(source.absolutePath, target.absolutePath, {
              recursive: sourceInfo.isDirectory(),
              force: false,
              errorOnExist: true,
            });
            if (sourceBytes > 0) this.quotas.addUsed(user.id, sourceBytes, this.now());
            this.scans.clear(user.id, targetRelative);
            this.auditSuccess(user, 'file.copy', source.relativePath, ctx, {
              newPath: targetRelative,
              size: sourceBytes,
            });
            copiedBytes += sourceBytes;
          } catch (error) {
            await rm(target.absolutePath, { recursive: true, force: true }).catch(() => {});
            if (error instanceof FileServiceError) throw error;
            throw new FileServiceError(
              FILE_ERROR.COPY_FAILED,
              '复制失败，请检查配额、目标路径或文件占用情况',
              500,
              { cause: error instanceof Error ? error.message : String(error) },
            );
          }
        }

        const targetInfo = await lstat(target.absolutePath);
        entries.push(entryOf(targetRelative, name, targetInfo));
      }

      return { entries, copiedBytes };
    });
  }

  async remove(
    user: SessionUser,
    relativePaths: string[],
    ctx: RequestContext,
  ): Promise<{ deleted: string[]; freedBytes: number }> {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '请至少选择一个路径', 400);
    }
    if (relativePaths.length > MAX_DELETE_PATHS) {
      throw new FileServiceError(
        FILE_ERROR.TOO_MANY_PATHS,
        `一次最多删除 ${MAX_DELETE_PATHS} 个路径`,
        400,
      );
    }

    return this.mutex.runExclusive(user.id, async () => {
      const now = this.now();
      let freedBytes = 0;
      const deleted: string[] = [];

      try {
        for (const relativePath of relativePaths) {
          if (relativePath === '') {
            throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '不能删除根目录', 400);
          }

          const resolved = this.resolve(user, relativePath, { expect: 'any' }, 'file.delete', ctx);
          const info = await lstat(resolved.absolutePath);
          const size = info.isDirectory()
            ? await measureDirectorySize(resolved.absolutePath)
            : info.size;

          await rm(resolved.absolutePath, { recursive: true, force: false });

          freedBytes += size;
          deleted.push(resolved.relativePath);
          this.scans.clear(user.id, resolved.relativePath);
          this.auditSuccess(user, 'file.delete', resolved.relativePath, ctx, { size });
          this.events?.emit('file.deleted', {
            userId: user.id,
            username: user.username,
            path: resolved.relativePath,
            size,
          });
        }
      } finally {
        if (freedBytes > 0) {
          this.quotas.addUsed(user.id, -freedBytes, now);
        }
      }

      return { deleted, freedBytes };
    });
  }

  async openDownload(
    user: SessionUser,
    relativePath: string,
    ctx: RequestContext,
  ): Promise<DownloadTarget> {
    const target = await this.inspectFile(user, relativePath, ctx, 'file.download');
    this.auditSuccess(user, 'file.download', target.relativePath, ctx, { size: target.size });
    return target;
  }

  async readText(
    user: SessionUser,
    relativePath: string,
    ctx: RequestContext,
    maxBytes = 256 * 1024,
  ): Promise<{ content: string; truncated: boolean; size: number }> {
    const target = await this.inspectFile(user, relativePath, ctx, 'file.ai-read');
    if (target.size > maxBytes) {
      const buffer = await readFile(target.absolutePath);
      return {
        content: buffer.subarray(0, maxBytes).toString('utf8'),
        truncated: true,
        size: target.size,
      };
    }
    return {
      content: await readFile(target.absolutePath, 'utf8'),
      truncated: false,
      size: target.size,
    };
  }

  async writeText(
    user: SessionUser,
    relativePath: string,
    content: string,
    overwrite: boolean,
    ctx: RequestContext,
  ): Promise<FileEntry> {
    const normalized = normalizeRelativePath(relativePath);
    const parent = path.posix.dirname(normalized);
    if (parent !== '.') {
      await mkdir(path.join(this.userRoot(user), ...parent.split('/')), { recursive: true });
    }
    const resolved = this.resolve(user, relativePath, { mustExist: false }, 'file.ai-write', ctx);
    let existingSize = 0;
    try {
      const existing = await lstat(resolved.absolutePath);
      if (!existing.isFile()) {
        throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '目标不是文件', 400);
      }
      if (!overwrite) throw new FileServiceError(FILE_ERROR.EXISTS, '文件已存在', 409);
      existingSize = existing.size;
    } catch (error) {
      if (error instanceof FileServiceError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    const delta = bytes - existingSize;
    if (delta > 0) this.assertQuota(user, delta);
    await writeFile(resolved.absolutePath, content, 'utf8');
    this.quotas.addUsed(user.id, delta, this.now());
    this.scans.clear(user.id, resolved.relativePath);
    const info = await lstat(resolved.absolutePath);
    this.auditSuccess(user, 'file.ai-write', resolved.relativePath, ctx, { size: bytes });
    this.events?.emit('file.uploaded', {
      userId: user.id,
      username: user.username,
      path: resolved.relativePath,
      size: bytes,
      overwrite: existingSize > 0,
    });
    return entryOf(resolved.relativePath, path.basename(resolved.relativePath), info);
  }

  async appendText(
    user: SessionUser,
    relativePath: string,
    content: string,
    ctx: RequestContext,
  ): Promise<FileEntry> {
    const normalized = normalizeRelativePath(relativePath);
    const parent = path.posix.dirname(normalized);
    if (parent !== '.') {
      await mkdir(path.join(this.userRoot(user), ...parent.split('/')), { recursive: true });
    }
    const resolved = this.resolve(user, relativePath, { mustExist: false }, 'file.ai-append', ctx);
    let existingSize = 0;
    try {
      existingSize = (await lstat(resolved.absolutePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    this.assertQuota(user, bytes);
    await appendFile(resolved.absolutePath, content, 'utf8');
    this.quotas.addUsed(user.id, bytes, this.now());
    this.scans.clear(user.id, resolved.relativePath);
    const info = await lstat(resolved.absolutePath);
    this.auditSuccess(user, 'file.ai-append', resolved.relativePath, ctx, { size: bytes });
    return entryOf(resolved.relativePath, path.basename(resolved.absolutePath), info);
  }

  private assertQuota(user: SessionUser, bytes: number): void {
    const quota = this.quotas.get(user.id);
    if (quota !== null && quota.quotaBytes !== null) {
      if (bytes > Math.max(0, quota.quotaBytes - quota.usedBytes)) {
        throw new FileServiceError(FILE_ERROR.QUOTA_EXCEEDED, '可用配额不足', 413);
      }
    }
  }

  async inspectFile(
    user: SessionUser,
    relativePath: string,
    ctx: RequestContext,
    action = 'file.inspect',
    options: { allowInfected?: boolean } = {},
  ): Promise<DownloadTarget> {
    const resolved = this.resolve(user, relativePath, { expect: 'file' }, action, ctx);
    if (!options.allowInfected) {
      this.assertNotInfected(user, resolved.relativePath);
    }
    const info = await lstat(resolved.absolutePath);

    return {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      name: path.basename(resolved.absolutePath),
      size: info.size,
      modifiedAt: Math.trunc(info.mtimeMs),
    };
  }

  private assertNotInfected(user: SessionUser, relativePath: string): void {
    if (this.scans.isInfected(user.id, relativePath)) {
      throw new FileServiceError(
        FILE_ERROR.FILE_INFECTED,
        '该文件已被安全查杀标记为病毒，禁止下载、分享或解压',
        403,
      );
    }
  }

  private assertPreviewPermission(kind: PreviewKind): void {
    const permission =
      kind === 'image'
        ? 'allow_user_preview_image'
        : kind === 'video'
          ? 'allow_user_preview_video'
          : kind === 'pdf'
            ? 'allow_user_preview_pdf'
            : kind === 'office'
              ? 'allow_user_preview_office'
              : null;

    if (permission !== null && !this.settings.get(permission)) {
      throw new FileServiceError(
        FILE_ERROR.FEATURE_DISABLED,
        '管理员已关闭该类型文件的在线预览权限',
        403,
      );
    }
  }

  /** 预览探测：只返回元信息，供前端决定渲染器；不读取完整文件 */
  async getPreviewInfo(
    user: SessionUser,
    relativePath: string,
    ctx: RequestContext,
  ): Promise<PreviewInfo> {
    const resolved = this.resolve(user, relativePath, { expect: 'file' }, 'file.preview', ctx);
    this.assertNotInfected(user, resolved.relativePath);
    const info = await lstat(resolved.absolutePath);
    const detected = await this.detectPreview(resolved.absolutePath, info.size);
    if (detected !== null) {
      this.assertPreviewPermission(detected.kind);
    }

    return {
      kind: detected?.kind ?? 'none',
      mime: detected?.mime ?? null,
      size: info.size,
      name: path.basename(resolved.absolutePath),
      path: resolved.relativePath,
    };
  }

  /**
   * 打开预览内容：
   *  - 图片/PDF：返回文件目标，由 HTTP 层以严格 Content-Type + inline 流式发送
   *  - 文本：服务端按 512KB 截断、识别编码并转 UTF-8，以 JSON 返回（前端用 <pre> 渲染）
   *  - 其他：抛 415，强制走下载
   */
  async openPreview(
    user: SessionUser,
    relativePath: string,
    ctx: RequestContext,
  ): Promise<PreviewContentResult> {
    const resolved = this.resolve(user, relativePath, { expect: 'file' }, 'file.preview', ctx);
    this.assertNotInfected(user, resolved.relativePath);
    const info = await lstat(resolved.absolutePath);
    const detected = await this.detectPreview(resolved.absolutePath, info.size);

    if (detected === null) {
      throw new FileServiceError(
        FILE_ERROR.PREVIEW_UNSUPPORTED,
        '该文件类型不支持在线预览，请下载后查看',
        415,
      );
    }
    this.assertPreviewPermission(detected.kind);

    if (detected.kind === 'text') {
      const truncated = info.size > TEXT_PREVIEW_LIMIT_BYTES;
      const buffer = await readPrefix(
        resolved.absolutePath,
        Math.min(info.size, TEXT_PREVIEW_LIMIT_BYTES),
      );
      const decoded = decodeTextBuffer(buffer);

      return this.auditTextPreview(
        user,
        resolved,
        ctx,
        decoded.text,
        decoded.encoding,
        truncated,
        info.size,
      );
    }

    this.auditSuccess(user, 'file.preview', resolved.relativePath, ctx, {
      kind: detected.kind,
      size: info.size,
    });

    return {
      kind: detected.kind,
      mime: detected.mime,
      target: {
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        name: path.basename(resolved.absolutePath),
        size: info.size,
        modifiedAt: Math.trunc(info.mtimeMs),
      },
    };
  }

  private auditTextPreview(
    user: SessionUser,
    resolved: ResolvedUserPath,
    ctx: RequestContext,
    text: string,
    encoding: string,
    truncated: boolean,
    size: number,
  ): PreviewTextResult {
    this.auditSuccess(user, 'file.preview', resolved.relativePath, ctx, {
      kind: 'text',
      encoding,
      truncated,
    });
    return { kind: 'text', text, encoding, truncated, size };
  }

  private async detectPreview(
    absolutePath: string,
    size: number,
  ): Promise<{ kind: PreviewKind; mime: string } | null> {
    const extension = path.extname(absolutePath).slice(1).toLowerCase();
    const header = await readPrefix(absolutePath, Math.min(size, SNIFF_BYTES));

    const officeMime = OFFICE_MIME_BY_EXT[extension];
    if (officeMime !== undefined) {
      const isZip = header.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004';
      return isZip ? { kind: 'office', mime: officeMime } : null;
    }

    let sniffedMime: string | undefined;
    try {
      sniffedMime = header.length > 0 ? (await fileTypeFromBuffer(header))?.mime : undefined;
    } catch {
      sniffedMime = undefined;
    }

    const imageMime = IMAGE_MIME_BY_EXT[extension];
    if (imageMime !== undefined) {
      // 扩展名与魔数必须同时匹配，防止伪装成图片的可执行内容
      return sniffedMime === imageMime ? { kind: 'image', mime: imageMime } : null;
    }

    if (extension === 'pdf') {
      const isPdf = header.subarray(0, 1_024).includes(Buffer.from('%PDF-'));
      return isPdf ? { kind: 'pdf', mime: 'application/pdf' } : null;
    }

    const audioMime = AUDIO_MIME_BY_EXT[extension];
    if (audioMime !== undefined) {
      const first4 = header.subarray(0, 4).toString('latin1');
      const isAudio =
        sniffedMime?.startsWith('audio/') ||
        (extension === 'mp3' &&
          (header.subarray(0, 3).toString('latin1') === 'ID3' ||
            (header.length >= 2 && header[0] === 0xff && (header[1]! & 0xe0) === 0xe0))) ||
        (extension === 'wav' &&
          first4 === 'RIFF' &&
          header.subarray(8, 12).toString('latin1') === 'WAVE') ||
        (extension === 'flac' && first4 === 'fLaC') ||
        (extension === 'm4a' && header.subarray(4, 8).toString('latin1') === 'ftyp') ||
        (extension === 'aac' && header.length >= 2 && header[0] === 0xff && (header[1]! & 0xf6) === 0xf0);
      if (isAudio) return { kind: 'audio', mime: audioMime };
      if (extension !== 'ogg') return null;
    }

    const videoMime = VIDEO_MIME_BY_EXT[extension];    if (videoMime !== undefined) {      const isVideo =
        extension === 'mp4'
          ? sniffedMime === 'video/mp4' || header.subarray(4, 8).toString('latin1') === 'ftyp'
          : extension === 'webm'
            ? sniffedMime === 'video/webm' ||
              (header.length >= 4 &&
                header[0] === 0x1a &&
                header[1] === 0x45 &&
                header[2] === 0xdf &&
                header[3] === 0xa3)
            : header.subarray(0, 4).toString('latin1') === 'OggS' ||
              (sniffedMime?.includes('ogg') ?? false);

      return isVideo ? { kind: 'video', mime: videoMime } : null;
    }

    if (TEXT_EXTENSIONS.has(extension)) {
      return { kind: 'text', mime: 'text/plain' };
    }

    return null;
  }

  getUsage(user: SessionUser): UsageInfo {
    const quota = this.quotas.get(user.id);
    const quotaBytes = quota === null ? 0 : quota.quotaBytes;
    const usedBytes = quota?.usedBytes ?? 0;

    return {
      quotaBytes,
      usedBytes,
      availableBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - usedBytes),
    };
  }

  /**
   * 上传预检（同步，必须在外层用户锁内调用）。
   * 返回的 limitBytes 交给流式接收器，做到超限立即断流。
   */
  prepareUpload(
    user: SessionUser,
    dirPath: string,
    rawFilename: string,
    overwrite: boolean,
    ctx: RequestContext,
  ): PreparedUpload {
    const filename = this.validateName(user, rawFilename, 'file.upload', ctx);
    const dir = this.resolve(user, dirPath, { expect: 'dir' }, 'file.upload', ctx);
    const relativePath = dir.relativePath === '' ? filename : `${dir.relativePath}/${filename}`;
    const target = this.resolve(user, relativePath, { mustExist: false }, 'file.upload', ctx);

    let existingSize = 0;
    try {
      const info = lstatSync(target.absolutePath);
      if (info.isSymbolicLink()) {
        throw new PathSecurityError(PATH_ERROR.SYMLINK, '目标路径包含符号链接，已拒绝', 403);
      }
      if (info.isDirectory()) {
        throw new FileServiceError(FILE_ERROR.TARGET_IS_DIRECTORY, '目标已存在且是目录', 409);
      }
      if (!overwrite) {
        throw new FileServiceError(
          FILE_ERROR.EXISTS,
          '同名文件已存在（如需覆盖请传 overwrite=1）',
          409,
        );
      }
      existingSize = info.size;
    } catch (error) {
      if (
        error instanceof PathSecurityError ||
        error instanceof FileServiceError ||
        !isErrno(error, 'ENOENT')
      ) {
        throw error;
      }
    }

    const quota = this.quotas.get(user.id);
    const quotaBytes = quota === null ? 0 : quota.quotaBytes;
    const usedBytes = quota?.usedBytes ?? 0;
    const remainingBytes =
      quotaBytes === null ? Number.POSITIVE_INFINITY : quotaBytes - usedBytes + existingSize;
    const maxFileBytes = this.settings.get('upload.maxFileBytes');
    const limitBytes = Math.min(remainingBytes, maxFileBytes);

    if (limitBytes <= 0) {
      throw new FileServiceError(FILE_ERROR.QUOTA_EXCEEDED, '可用配额不足，无法上传', 413, {
        quotaBytes,
        usedBytes,
        remainingBytes: Math.max(0, remainingBytes),
      });
    }

    return {
      dir: dir.relativePath,
      filename,
      relativePath,
      absolutePath: target.absolutePath,
      existingSize,
      overwrite,
      quotaBytes,
      usedBytes,
      remainingBytes,
      maxFileBytes,
      limitBytes,
    };
  }

  /**
   * 上传提交：先更新配额（事务），再原子 rename 落位；rename 失败则补偿配额。
   * 必须由调用方持有用户锁，并保证 tempPath 与目标在同一磁盘卷上。
   */
  async commitUpload(
    user: SessionUser,
    prepared: PreparedUpload,
    tempPath: string,
    size: number,
    ctx: RequestContext,
  ): Promise<FileEntry> {
    if (size > prepared.limitBytes) {
      throw new FileServiceError(FILE_ERROR.FILE_TOO_LARGE, '文件超出允许的大小', 413);
    }

    const now = this.now();
    const delta = size - prepared.existingSize;

    this.db.transaction(() => {
      this.quotas.addUsed(user.id, delta, now);
    })();

    try {
      await renameWithRetry(tempPath, prepared.absolutePath);
      this.scans.clear(user.id, prepared.relativePath);
    } catch {
      this.quotas.addUsed(user.id, -delta, now);
      throw new FileServiceError(FILE_ERROR.RENAME_FAILED, '文件落盘失败，请重试', 500);
    }

    const info = await lstat(prepared.absolutePath);
    this.auditSuccess(user, 'file.upload', prepared.relativePath, ctx, {
      size,
      overwrite: prepared.overwrite,
    });
    this.events?.emit('file.uploaded', {
      userId: user.id,
      username: user.username,
      path: prepared.relativePath,
      size,
      overwrite: prepared.overwrite,
    });

    return entryOf(prepared.relativePath, prepared.filename, info);
  }

  auditUploadFailure(
    user: SessionUser,
    targetPath: string,
    error: unknown,
    ctx: RequestContext,
  ): void {
    const code =
      (error as { code?: string } | null)?.code ??
      (error instanceof PathSecurityError ? error.code : 'UPLOAD_FAILED');
    const message = error instanceof Error ? error.message : String(error);

    this.audit.record({
      actorType: ctx.actor?.type ?? (user.role === 'admin' ? 'admin' : 'user'),
      actorId: ctx.actor?.id ?? user.id,
      action: 'file.upload',
      result: 'denied',
      targetType: 'file',
      targetPath,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail: { code, message },
    });
  }

  private userRoot(user: SessionUser): string {
    return path.join(this.storageRoot, user.storageKey);
  }

  private resolve(
    user: SessionUser,
    relativePath: string,
    options: { mustExist?: boolean; expect?: 'any' | 'file' | 'dir' },
    action: string,
    ctx: RequestContext,
  ): ResolvedUserPath {
    try {
      return resolveUserPath(this.userRoot(user), relativePath, options);
    } catch (error) {
      if (error instanceof PathSecurityError) {
        this.auditDenied(user, action, relativePath, error, ctx);
      }
      throw error;
    }
  }

  private validateName(
    user: SessionUser,
    rawName: string,
    action: string,
    ctx: RequestContext,
  ): string {
    try {
      const normalized = normalizeRelativePath(rawName);
      if (normalized === '' || normalized.includes('/')) {
        throw new FileServiceError(FILE_ERROR.INVALID_NAME, '文件名不合法', 400);
      }
      return normalized;
    } catch (error) {
      this.auditDenied(user, action, rawName, error, ctx);
      throw error instanceof FileServiceError
        ? error
        : new FileServiceError(FILE_ERROR.INVALID_NAME, '文件名不合法', 400);
    }
  }

  private auditSuccess(
    user: SessionUser,
    action: string,
    targetPath: string,
    ctx: RequestContext,
    detail?: unknown,
  ): void {
    this.audit.record({
      actorType: ctx.actor?.type ?? (user.role === 'admin' ? 'admin' : 'user'),
      actorId: ctx.actor?.id ?? user.id,
      action,
      result: 'success',
      targetType: 'file',
      targetPath,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail,
    });
  }

  private auditDenied(
    user: SessionUser,
    action: string,
    targetPath: string,
    error: unknown,
    ctx: RequestContext,
  ): void {
    const code =
      error instanceof PathSecurityError || error instanceof FileServiceError
        ? error.code
        : 'UNKNOWN';
    const message = error instanceof Error ? error.message : String(error);

    this.audit.record({
      actorType: ctx.actor?.type ?? (user.role === 'admin' ? 'admin' : 'user'),
      actorId: ctx.actor?.id ?? user.id,
      action,
      result: 'denied',
      targetType: 'file',
      targetPath,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
      detail: { code, message },
    });
  }
}
