import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, rmSync, statSync } from 'node:fs';
import type { SessionUser } from '../types/models.ts';
import type { RequestContext } from './fileService.ts';
import { FILE_ERROR, FileServiceError, type FileService } from './fileService.ts';
import { resolveUserPath, normalizeRelativePath } from '../security/safePath.ts';
import { path7za } from '7zip-bin';
import type { SettingsService } from './settingsService.ts';
import type { TaskService } from './taskService.ts';
import type { QuotaRepository } from '../db/repositories/quotaRepo.ts';
import type { AuditService } from './auditService.ts';
import { compressionGate } from '../../server/concurrency.ts';

function sevenBinary(): string {
  return path7za;
}

export class CompressionService {
  private readonly files: FileService;
  private readonly storageRoot: string;
  private readonly settings: SettingsService;
  private readonly tasks: TaskService;
  private readonly quotas: QuotaRepository;
  private readonly audit: AuditService;

  constructor(options: {
    files: FileService;
    storageRoot: string;
    settings: SettingsService;
    tasks: TaskService;
    quotas: QuotaRepository;
    audit: AuditService;
  }) {
    this.files = options.files;
    this.storageRoot = options.storageRoot;
    this.settings = options.settings;
    this.tasks = options.tasks;
    this.quotas = options.quotas;
    this.audit = options.audit;
  }

  async start(
    user: SessionUser,
    input: { paths: string[]; targetDir: string; archiveName: string; level: number; password?: string | null },
    ctx: RequestContext,
  ): Promise<{ taskId: string }> {
    if (!this.settings.get('allow_user_compress')) {
      throw new FileServiceError(FILE_ERROR.FEATURE_DISABLED, '管理员已关闭压缩功能', 403);
    }
    const limits = this.settings.getLowLevel();
    if (input.paths.length === 0 || input.paths.length > limits.compressMaxFiles) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, `压缩文件数不能超过 ${limits.compressMaxFiles}`, 413);
    }
    const archiveName = input.archiveName.trim();
    if (!/^[^/\\]+\.zip$/i.test(archiveName)) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩包名称必须以 .zip 结尾', 400);
    }
    const targetDir = input.targetDir.trim();
    const userRoot = path.join(this.storageRoot, user.storageKey);
    const target = resolveUserPath(userRoot, targetDir, { expect: 'dir' });
    const archive = path.join(target.absolutePath, archiveName);
    if (archive === target.absolutePath) throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩包路径不合法', 400);

    let totalBytes = 0;
    const sourcePaths: string[] = [];
    for (const value of input.paths) {
      const relative = normalizeRelativePath(value);
      const absolute = resolveUserPath(userRoot, relative, { mustExist: true });
      const info = statSync(absolute.absolutePath);
      if (!info.isFile()) continue;
      totalBytes += info.size;
      sourcePaths.push(relative);
    }
    if (sourcePaths.length === 0) throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '没有可压缩的文件', 400);
    if (totalBytes > limits.compressMaxBytes) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩源文件总大小超过限制', 413);
    }

    const level = Math.max(1, Math.min(9, Math.trunc(input.level)));
    const password = input.password ?? '';
    if (password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) {
      throw new FileServiceError(FILE_ERROR.INVALID_OPERATION, '压缩密码不合法', 400);
    }
    const task = this.tasks.create(user.id, 'compress', 'queued', {
      paths: input.paths, targetDir, archiveName, level: input.level,
      ...(password === '' ? {} : { password }),
    });
    const residual = path.posix.join(target.relativePath, archiveName);
    this.tasks.update(task.id, { residualPaths: [residual] });
    const ticket = compressionGate.enqueue(limits.compressConcurrent, undefined, (position) => {
      this.tasks.update(task.id, { queuePosition: position });
    });
    this.tasks.registerCancel(task.id, () => ticket.cancel());
    void ticket.promise.then(async () => {
      try {
        await this.run(task.id, user, userRoot, target.relativePath, archive, sourcePaths, level, password, limits.compressTimeoutSeconds * 1_000, ctx);
      } finally {
        ticket.release();
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.tasks.update(task.id, { status: message.includes('cancelled') ? 'cancelled' : 'failed', error: message.includes('cancelled') ? '已取消' : message, queuePosition: null });
    });
    return { taskId: task.id };
  }

  private run(
    taskId: string,
    user: SessionUser,
    userRoot: string,
    targetDir: string,
    archive: string,
    sourcePaths: string[],
    level: number,
    password: string,
    timeoutMs: number,
    ctx: RequestContext,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const queuedTask = this.tasks.getForUser(taskId, user.id);
      if (queuedTask === null || queuedTask.status === 'cancelled' || queuedTask.status === 'paused') { resolve(); return; }
      this.tasks.update(taskId, { status: 'running', queuePosition: null });
      const previousSize = existsSync(archive) ? statSync(archive).size : 0;
      const args = password === ''
        ? ['a', '-tzip', `-mx=${level}`, '-y', archive, ...sourcePaths]
        : ['a', '-tzip', `-mx=${level}`, '-mem=AES256', `-p${password}`, '-y', archive, ...sourcePaths];
      const child = spawn(sevenBinary(), args, {
        cwd: userRoot,
        windowsHide: true,
      });
      let stderr = '';
      let cancelled = false;
      this.tasks.registerCancel(taskId, () => { cancelled = true; child.kill(); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(0, 2_000); });
      const timer = setTimeout(() => {
        child.kill();
        this.tasks.update(taskId, { status: 'failed', error: '压缩超时' });
        resolve();
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        this.tasks.unregisterCancel(taskId);
        this.tasks.update(taskId, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? '已取消' : error.message });
        resolve();
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        this.tasks.unregisterCancel(taskId);
        if (cancelled) {
          try { rmSync(archive, { force: true }); } catch { /* best effort */ }
          if (previousSize > 0) this.quotas.addUsed(user.id, -previousSize, Date.now());
          this.tasks.update(taskId, { status: 'cancelled', error: '已取消', residualPaths: [] });
          resolve();
          return;
        }
        if (code === 0) {
          const size = statSync(archive).size;
          this.quotas.addUsed(user.id, size - previousSize, Date.now());
          this.tasks.update(taskId, { status: 'completed', result: { archive: path.posix.join(targetDir, path.basename(archive)), bytes: size, encrypted: password !== '' }, residualPaths: [] });
          this.audit.record({ actorType: 'user', actorId: user.id, action: 'file.compress', result: 'success', targetType: 'file', targetPath: archive, ip: ctx.ip ?? null, detail: { bytes: size, encrypted: password !== '' } });
        } else {
          this.tasks.update(taskId, { status: 'failed', error: stderr.trim() || `7za 退出码 ${code}` });
        }
        resolve();
      });
    });
  }
}
