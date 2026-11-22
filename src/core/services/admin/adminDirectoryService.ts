import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CoreServices } from '../../container.ts';
import type { AuditService } from '../auditService.ts';
import { pathsAreEnvLocked, saveHeadlessPaths, type HeadlessPaths } from '../../../server-entry/paths.ts';

export type DirectoryKind = 'data' | 'storage' | 'plugins';

export interface DirectoryChangeInput {
  kind: DirectoryKind;
  targetPath: string;
  migrate: boolean;
  deleteOld: boolean;
}

export interface AdminDirectoryRuntime {
  stopUser(): Promise<void>;
  startUser(): Promise<void>;
  getUserRunning(): boolean;
  restartProcess(): void;
}

function normalize(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function overlaps(a: string, b: string): boolean {
  const left = normalize(path.resolve(a));
  const right = normalize(path.resolve(b));
  const rel = path.relative(left, right);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function validateTarget(current: string, value: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new Error('目标路径必须是绝对路径');
  const target = path.resolve(value);
  if (normalize(target) === normalize(current)) throw new Error('新目录不能与当前目录相同');
  if (path.parse(target).root === target) throw new Error('不能选择磁盘根目录');
  if (overlaps(current, target) || overlaps(target, current)) {
    throw new Error('新目录不能位于当前目录内，也不能包含当前目录');
  }
  if (existsSync(target)) {
    if (!(await stat(target)).isDirectory()) throw new Error('目标路径不是目录');
    if ((await readdir(target)).length > 0) throw new Error('目标目录必须为空');
  } else {
    await mkdir(target, { recursive: true });
  }
  return target;
}

/** Headless directory migration. The process exits after writing the path state so the service restarts. */
export class AdminDirectoryService {
  private readonly services: CoreServices;
  private readonly audit: AuditService;
  private readonly paths: HeadlessPaths;
  private readonly runtime: AdminDirectoryRuntime;

  constructor(options: {
    services: CoreServices;
    audit: AuditService;
    paths: HeadlessPaths;
    runtime: AdminDirectoryRuntime;
  }) {
    this.services = options.services;
    this.audit = options.audit;
    this.paths = options.paths;
    this.runtime = options.runtime;
  }

  current(): HeadlessPaths {
    return { ...this.paths };
  }

  async change(input: DirectoryChangeInput, actor: { id: number }): Promise<{ restarting: boolean }> {
    if (pathsAreEnvLocked()) throw new Error('目录由环境变量固定，不能在 Web 界面修改');
    const current = input.kind === 'data'
      ? this.paths.dataDir
      : input.kind === 'storage'
        ? this.paths.storageDir
        : this.paths.pluginsDir;
    const target = await validateTarget(current, input.targetPath);

    const userWasRunning = this.runtime.getUserRunning();
    if (userWasRunning) await this.runtime.stopUser();
    await this.services.plugins.stopAll().catch(() => {});

    try {
      if (input.kind === 'data') {
        this.services.db.pragma('wal_checkpoint(TRUNCATE)');
        await this.services.db.backup(path.join(target, 'cloudbox.db'));
        const config = path.join(this.paths.dataDir, 'config');
        if (existsSync(config)) await cp(config, path.join(target, 'config'), { recursive: true, force: false, errorOnExist: true });
        const secret = path.join(this.paths.dataDir, 'ai-secret.key');
        if (existsSync(secret)) await cp(secret, path.join(target, 'ai-secret.key'), { force: false, errorOnExist: true });
      } else if (input.kind === 'storage') {
        if (input.migrate) await cp(this.paths.storageDir, target, { recursive: true, force: true });
        for (const user of this.services.users.list()) await mkdir(path.join(target, user.storageKey), { recursive: true });
      } else if (input.migrate) {
        await cp(this.paths.pluginsDir, target, { recursive: true, force: true });
      }

      const next = {
        ...this.paths,
        ...(input.kind === 'data' ? { dataDir: target } : {}),
        ...(input.kind === 'storage' ? { storageDir: target } : {}),
        ...(input.kind === 'plugins' ? { pluginsDir: target } : {}),
      };
      saveHeadlessPaths(next);
      this.audit.record({
        actorType: 'admin',
        actorId: actor.id,
        action: 'directory.change',
        result: 'success',
        targetType: `${input.kind}-directory`,
        targetPath: target,
        detail: { migrate: input.migrate, previous: current },
      });

      // Keep the old data directory: it contains the headless path pointer used on restart.
      // Storage/plugin directories can be removed safely after a successful copy.
      if (input.deleteOld && input.kind !== 'data') {
        await rm(current, { recursive: true, force: true }).catch(() => {});
      }
      setTimeout(() => this.runtime.restartProcess(), 700).unref();
      return { restarting: true };
    } catch (error) {
      if (userWasRunning) await this.runtime.startUser().catch(() => {});
      throw error;
    }
  }
}
