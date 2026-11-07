import { existsSync } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { normalizeRelativePath, resolveUserPath, PATH_ERROR, PathSecurityError } from '../security/safePath.ts';
import type { QuotaRepository } from '../db/repositories/quotaRepo.ts';
import type { SessionUser } from '../types/models.ts';
import type { AuditService } from './auditService.ts';
import {
  FILE_ERROR,
  FileServiceError,
  type FileService,
  type RequestContext,
} from './fileService.ts';
import type { SettingsService } from './settingsService.ts';
import type { TaskService } from './taskService.ts';

export const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar', '.tar.gz', '.tgz'];

export function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function resolveSevenZipBinary(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const candidates = [path.join(resourcesPath, 'bin', '7za.exe'), path.join(resourcesPath, 'bin', '7za')];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return path7za;
}

interface ArchiveEntry {
  file: string;
  attributes: string;
  size: number;
  isDirectory: boolean;
}

function listArchive(archive: string, binary: string): Promise<ArchiveEntry[]> {
  return new Promise<ArchiveEntry[]>((resolve, reject) => {
    const entries: ArchiveEntry[] = [];
    const stream = Seven.list(archive, { $bin: binary });

    stream.on('data', (entry) => {
      if (typeof entry.file !== 'string' || entry.file.length === 0) return;
      entries.push({
        file: entry.file,
        attributes: entry.attributes ?? '',
        size: entry.size ?? 0,
        isDirectory: (entry.attributes ?? '').startsWith('D'),
      });
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(entries));
  });
}

function extractArchive(archive: string, target: string, binary: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = Seven.extractFull(archive, target, { $bin: binary, yes: true });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
}

/**
 * 解压目标允许“父目录尚不存在”，但必须在用户根目录内；
 * 对已存在的祖先逐段 lstat，拒绝符号链接。
 */
async function resolveNewPath(userRoot: string, relative: string): Promise<string> {
  const normalized = normalizeRelativePath(relative);
  const absolute = path.resolve(userRoot, ...normalized.split('/'));
  const relativeToRoot = path.relative(userRoot, absolute);
  if (
    relativeToRoot === '' ||
    relativeToRoot.startsWith('..') ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new PathSecurityError(PATH_ERROR.OUTSIDE_ROOT, '解压路径越过用户根目录');
  }

  const segments = normalized.split('/');
  let current = userRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new PathSecurityError(PATH_ERROR.SYMLINK, '解压路径包含符号链接');
      }
      if (!info.isDirectory()) {
        throw new PathSecurityError(PATH_ERROR.NOT_A_DIRECTORY, '解压路径的父级不是目录');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }

  return absolute;
}

/**
 * 安全解压：
 *  - 先用 7z 列出全部条目，对每个相对路径调用 safePath（normalize + resolveUserPath）
 *  - 拒绝 ../、绝对路径、符号链接和已存在目标
 *  - 解压异步执行；失败清理已生成文件；成功后一次性计入配额
 */
export class ExtractionService {
  private readonly files: FileService;
  private readonly storageRoot: string;
  private readonly quotas: QuotaRepository;
  private readonly tasks: TaskService;
  private readonly audit: AuditService;
  private readonly settings: SettingsService;
  private readonly sevenZipBinary: string;
  private readonly now: () => number;

  constructor(options: {
    files: FileService;
    storageRoot: string;
    quotas: QuotaRepository;
    tasks: TaskService;
    audit: AuditService;
    settings: SettingsService;
    sevenZipBinary?: string;
    now?: () => number;
  }) {
    this.files = options.files;
    this.storageRoot = options.storageRoot;
    this.quotas = options.quotas;
    this.tasks = options.tasks;
    this.audit = options.audit;
    this.settings = options.settings;
    this.sevenZipBinary = options.sevenZipBinary ?? resolveSevenZipBinary();
    this.now = options.now ?? Date.now;
  }

  async start(
    user: SessionUser,
    filePath: string,
    targetDir: string,
    ctx: RequestContext,
  ): Promise<{ taskId: string }> {
    if (!this.settings.get('allow_user_extract')) {
      throw new FileServiceError(FILE_ERROR.FEATURE_DISABLED, '管理员已关闭解压功能', 403);
    }

    const archive = await this.files.inspectFile(user, filePath, ctx, 'file.extract');
    if (!isArchiveName(archive.name)) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '不支持的压缩包格式', 400);
    }

    const userRoot = path.join(this.storageRoot, user.storageKey);
    const target = resolveUserPath(userRoot, targetDir, { expect: 'dir' });

    const entries = await listArchive(archive.absolutePath, this.sevenZipBinary);
    const cleanupPaths: string[] = [];
    let totalBytes = 0;

    for (const entry of entries) {
      if (entry.attributes.toLowerCase().includes('l')) {
        throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩包包含符号链接，已拒绝解压', 400);
      }

      const normalized = normalizeRelativePath(entry.file);
      if (normalized === '') continue;

      const combined = target.relativePath === '' ? normalized : `${target.relativePath}/${normalized}`;
      const absolute = await resolveNewPath(userRoot, combined);

      try {
        await lstat(absolute);
        throw new FileServiceError(
          FILE_ERROR.EXISTS,
          `解压目标已存在：${normalized}`,
          409,
        );
      } catch (error) {
        if (error instanceof FileServiceError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      cleanupPaths.push(absolute);
      if (!entry.isDirectory) totalBytes += entry.size;
    }

    const quota = this.quotas.get(user.id);
    if (
      quota !== null &&
      quota.quotaBytes !== null &&
      totalBytes > Math.max(0, quota.quotaBytes - quota.usedBytes)
    ) {
      throw new FileServiceError(FILE_ERROR.QUOTA_EXCEEDED, '剩余配额不足以解压该压缩包', 413);
    }

    const task = this.tasks.create(user.id, 'extract', 'running');
    void this.run(task.id, user, archive.absolutePath, target.absolutePath, cleanupPaths, totalBytes, ctx);
    return { taskId: task.id };
  }

  private async run(
    taskId: string,
    user: SessionUser,
    archivePath: string,
    targetPath: string,
    cleanupPaths: string[],
    totalBytes: number,
    ctx: RequestContext,
  ): Promise<void> {
    try {
      await extractArchive(archivePath, targetPath, this.sevenZipBinary);

      if (totalBytes > 0) {
        this.quotas.addUsed(user.id, totalBytes, this.now());
      }

      this.tasks.update(taskId, {
        status: 'completed',
        result: {
          extractedFiles: cleanupPaths.length,
          extractedBytes: totalBytes,
        },
      });
      this.audit.record({
        actorType: 'user',
        actorId: user.id,
        action: 'file.extract',
        result: 'success',
        targetType: 'file',
        targetPath: archivePath,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
        detail: { targetPath, extractedBytes: totalBytes },
      });
    } catch (error) {
      // 解压失败：删除已生成路径，避免留下未计费/部分损坏文件
      for (const target of cleanupPaths.reverse()) {
        await rm(target, { recursive: true, force: true }).catch(() => {});
      }

      const message = error instanceof Error ? error.message : String(error);
      this.tasks.update(taskId, { status: 'failed', error: message });
      this.audit.record({
        actorType: 'user',
        actorId: user.id,
        action: 'file.extract',
        result: 'error',
        targetType: 'file',
        targetPath: archivePath,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
        detail: { message },
      });
    }
  }
}
