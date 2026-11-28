import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { extractionGate } from '../../server/concurrency.ts';

export const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar', '.tar.gz', '.tgz'];
export const MAX_EXTRACT_FILES = 10_000;
export const MAX_EXTRACT_TOTAL_BYTES = 50 * 1024 ** 3;
export const SEVEN_ZIP_TIMEOUT_MS = 5 * 60_000;

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

const execFileAsync = promisify(execFile);

function isEncryptedError(message: string): boolean {
  return /password|encrypted|headers error|cannot open encrypted|can not open encrypted/i.test(message);
}

async function probeArchive(archive: string, binary: string): Promise<{ encrypted: boolean; error: string | null }> {
  try {
    const { stdout } = await execFileAsync(binary, ['l', '-slt', archive], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    return { encrypted: /^Encrypted = \+/m.test(String(stdout)), error: null };
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const text = [detail.stderr, detail.stdout, detail.message].filter(Boolean).join('\n');
    return { encrypted: isEncryptedError(text), error: text || '压缩包无法读取' };
  }
}

async function verifyArchivePassword(archive: string, binary: string, password: string): Promise<void> {
  try {
    await execFileAsync(binary, ['t', `-p${password}`, archive], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  } catch {
    throw new FileServiceError(FILE_ERROR.ARCHIVE_PASSWORD_INVALID, '压缩包密码不正确', 400);
  }
}

function listArchive(archive: string, binary: string, maxFiles: number, timeoutMs: number, password?: string): Promise<ArchiveEntry[]> {
  return new Promise<ArchiveEntry[]>((resolve, reject) => {
    const entries: ArchiveEntry[] = [];
    const stream = Seven.list(archive, { $bin: binary, ...(password ? { password } : {}) });
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      (stream as unknown as { destroy?: () => void; _childProcess?: { kill?: () => void } })._childProcess?.kill?.();
      (stream as unknown as { destroy?: () => void }).destroy?.();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(`7z 列目录超时（${Math.round(timeoutMs / 60_000)} 分钟）`)), timeoutMs);
    timer.unref?.();

    stream.on('data', (entry) => {
      if (settled || typeof entry.file !== 'string' || entry.file.length === 0) return;
      entries.push({
        file: entry.file,
        attributes: entry.attributes ?? '',
        size: entry.size ?? 0,
        isDirectory: (entry.attributes ?? '').startsWith('D'),
      });
      if (entries.length > maxFiles) fail(new Error(`压缩包文件数超过上限（${maxFiles}）`));
    });
    stream.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
    stream.on('end', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(entries); });
  });
}

function extractArchive(archive: string, target: string, binary: string, timeoutMs: number, password: string, onCancelReady?: (kill: () => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = Seven.extractFull(archive, target, { $bin: binary, yes: true, ...(password ? { password } : {}) });
    const kill = (): void => { (stream as unknown as { destroy?: () => void; _childProcess?: { kill?: () => void } })._childProcess?.kill?.(); (stream as unknown as { destroy?: () => void }).destroy?.(); };
    onCancelReady?.(kill);
    const timer = setTimeout(() => { (stream as unknown as { destroy?: () => void; _childProcess?: { kill?: () => void } })._childProcess?.kill?.(); (stream as unknown as { destroy?: () => void }).destroy?.(); reject(new Error(`7z 解压超时（${Math.round(timeoutMs / 60_000)} 分钟）`)); }, timeoutMs);
    timer.unref?.();
    stream.on('error', (error) => { clearTimeout(timer); reject(error); });
    stream.on('end', () => { clearTimeout(timer); resolve(); });
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

  async listPreview(
    user: SessionUser,
    filePath: string,
    ctx: RequestContext,
  ): Promise<Array<{ path: string; size: number; isDirectory: boolean }>> {
    if (!this.settings.get('allow_user_archive_preview')) {
      throw new FileServiceError(FILE_ERROR.FEATURE_DISABLED, '管理员已关闭压缩包预览', 403);
    }
    if (!isArchiveName(filePath)) {
      throw new FileServiceError(FILE_ERROR.PREVIEW_UNSUPPORTED, '仅支持压缩包预览', 415);
    }
    const limits = this.settings.getLowLevel();
    const target = await this.files.inspectFile(user, filePath, ctx, 'file.preview');
    const entries = await listArchive(target.absolutePath, this.sevenZipBinary, limits.archivePreviewMaxEntries, limits.archivePreviewTimeoutSeconds * 1_000);
    let total = 0;
    for (const entry of entries) total += entry.isDirectory ? 0 : entry.size;
    if (total > limits.archivePreviewMaxBytes) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩包预览总大小超过限制', 413);
    }
    return entries.map((entry) => ({ path: entry.file, size: entry.size, isDirectory: entry.isDirectory }));
  }

  async start(
    user: SessionUser,
    filePath: string,
    targetDir: string,
    ctx: RequestContext,
    password = '',
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

    const limits = this.settings.getLowLevel();
    const timeoutMs = limits.extractTimeoutSeconds * 1_000;
    if (password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩包密码不合法', 400);
    }
    const probe = await probeArchive(archive.absolutePath, this.sevenZipBinary);
    if (probe.encrypted && password === '') {
      throw new FileServiceError(FILE_ERROR.ARCHIVE_PASSWORD_REQUIRED, '压缩包已加密，请输入密码', 400);
    }
    if (probe.encrypted && password !== '') await verifyArchivePassword(archive.absolutePath, this.sevenZipBinary, password);
    if (probe.error !== null && !probe.encrypted) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩包损坏或无法读取', 400);
    }
    const entries = await listArchive(archive.absolutePath, this.sevenZipBinary, limits.extractMaxFiles, timeoutMs, password);
    if (entries.length > limits.extractMaxFiles) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, `压缩包文件数超过上限（${limits.extractMaxFiles}）`, 413);
    }
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
      if (!entry.isDirectory) {
        if (entry.size > limits.extractEntryBytes) {
          throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, `压缩包内单文件超过上限（${limits.extractEntryBytes} 字节）`, 413);
        }
        totalBytes += entry.size;
      }
      if (totalBytes > limits.extractTotalBytes) {
        throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, `压缩包解压后总大小超过上限（${Math.floor(limits.extractTotalBytes / 1024 ** 3)}GB）`, 413);
      }
    }

    const archiveSize = Math.max(1, archive.size ?? 0);
    if (totalBytes / archiveSize > limits.extractCompressionRatio) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, `压缩包压缩比超过上限（${limits.extractCompressionRatio} 倍）`, 413);
    }

    const quota = this.quotas.get(user.id);
    if (
      quota !== null &&
      quota.quotaBytes !== null &&
      totalBytes > Math.max(0, quota.quotaBytes - quota.usedBytes)
    ) {
      throw new FileServiceError(FILE_ERROR.QUOTA_EXCEEDED, '剩余配额不足以解压该压缩包', 413);
    }

    const residualPaths = cleanupPaths.map((absolute) => path.relative(userRoot, absolute).split(path.sep).join('/'));
    const task = this.tasks.create(user.id, 'extract', 'queued', { filePath, targetDir, ...(password === '' ? {} : { password }) });
    this.tasks.update(task.id, { residualPaths });
    const ticket = extractionGate.enqueue(this.settings.get('maxConcurrentExtractions'), undefined, (position) => {
      this.tasks.update(task.id, { queuePosition: position });
    });
    this.tasks.registerCancel(task.id, () => ticket.cancel());
    void ticket.promise.then(async () => {
      try {
        await this.run(task.id, user, archive.absolutePath, target.absolutePath, cleanupPaths, totalBytes, timeoutMs, ctx, password);
      } finally {
        ticket.release();
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.tasks.update(task.id, { status: message.includes('cancelled') ? 'cancelled' : 'failed', error: message.includes('cancelled') ? '已取消' : message, queuePosition: null, residualPaths: [] });
    });
    return { taskId: task.id };
  }

  private async run(
    taskId: string,
    user: SessionUser,
    archivePath: string,
    targetPath: string,
    cleanupPaths: string[],
    totalBytes: number,
    timeoutMs: number,
    ctx: RequestContext,
    password: string,
  ): Promise<void> {
    const queuedTask = this.tasks.getForUser(taskId, user.id);
    if (queuedTask === null || queuedTask.status === 'cancelled' || queuedTask.status === 'paused') return;
    let cancelled = false;
    this.tasks.update(taskId, { status: 'running', queuePosition: null });
    try {
      await extractArchive(archivePath, targetPath, this.sevenZipBinary, timeoutMs, password, (kill) => {
        this.tasks.registerCancel(taskId, () => { cancelled = true; kill(); });
      });

      if (totalBytes > 0) {
        this.quotas.addUsed(user.id, totalBytes, this.now());
      }

      this.tasks.unregisterCancel(taskId);
      this.tasks.update(taskId, {
        status: 'completed',
        residualPaths: [],
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

      this.tasks.unregisterCancel(taskId);
      const message = error instanceof Error ? error.message : String(error);
      this.tasks.update(taskId, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? '已取消' : message, residualPaths: cancelled ? [] : (this.tasks.getForUser(taskId, user.id)?.residualPaths ?? []) });
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
