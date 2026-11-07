import { app } from 'electron';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MainContext } from './context.ts';
import { saveAppPaths } from './pathConfig.ts';

export type DirectoryKind = 'data' | 'storage' | 'plugins';

export interface ChangeDirectoryInput {
  kind: DirectoryKind;
  targetPath: string;
  migrate: boolean;
}

function normalize(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function pathsOverlap(a: string, b: string): boolean {
  const left = normalize(path.resolve(a));
  const right = normalize(path.resolve(b));
  const rel = path.relative(left, right);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function validateTarget(current: string, targetPath: string): Promise<string> {
  const target = path.resolve(targetPath);

  if (normalize(target) === normalize(current)) {
    throw new Error('新目录不能与当前目录相同');
  }
  if (path.parse(target).root === target) {
    throw new Error('不能选择磁盘根目录作为存储目录');
  }
  if (pathsOverlap(current, target) || pathsOverlap(target, current)) {
    throw new Error('新目录不能位于当前目录内部，也不能包含当前目录');
  }

  if (existsSync(target)) {
    const stats = await stat(target);
    if (!stats.isDirectory()) throw new Error('目标路径不是目录');
    const entries = await readdir(target);
    if (entries.length > 0) {
      throw new Error('目标目录必须为空，避免覆盖或混合已有数据');
    }
  } else {
    await mkdir(target, { recursive: true });
  }

  return target;
}

async function initializeStorage(
  context: MainContext,
  target: string,
): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const user of context.services.users.list()) {
    await mkdir(path.join(target, user.storageKey), { recursive: true });
  }
}

function scheduleRelaunch(context: MainContext): void {
  const timer = setTimeout(() => {
    try {
      context.services.db.close();
    } catch {
      // 忽略关闭错误，应用即将退出
    }
    app.relaunch();
    app.exit(0);
  }, 700);
  void timer;
}

/**
 * 修改系统数据目录或网盘文件目录。
 *
 * - 仅改路径：不移动旧数据，目标目录为空；storage 会按现有用户初始化子目录。
 * - 迁移数据：先停服务，再复制数据库/配置或 storage，写入路径配置后重启应用。
 */
export async function changeDirectory(
  context: MainContext,
  input: ChangeDirectoryInput,
): Promise<{ restarting: boolean }> {
  if (
    process.env.CLOUDBOX_DATA_DIR ||
    process.env.CLOUDBOX_STORAGE_DIR ||
    process.env.CLOUDBOX_PLUGINS_DIR
  ) {
    throw new Error('当前目录由环境变量固定，无法在界面中修改');
  }

  const kind = input.kind;
  const current =
    kind === 'data'
      ? context.dataDir
      : kind === 'storage'
        ? context.storageRoot
        : context.pluginsDir;
  const target = await validateTarget(current, input.targetPath);
  const serverStatus = context.server.getStatus();
  const frpWasRunning = context.frp.isRunning();
  const pluginsWereRunning = context.services.plugins.list().some((plugin) => plugin.running);

  if (pluginsWereRunning) await context.services.plugins.stopAll();
  if (serverStatus.running) {
    await context.server.stop();
  }
  if (frpWasRunning) {
    await context.frp.stop().catch(() => {});
  }

  try {
    if (kind === 'data') {
      if (input.migrate) {
        context.services.db.pragma('wal_checkpoint(TRUNCATE)');
        await context.services.db.backup(path.join(target, 'cloudbox.db'));

        const configSource = path.join(context.dataDir, 'config');
        if (existsSync(configSource)) {
          await cp(configSource, path.join(target, 'config'), {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        }
      }

      saveAppPaths({
        dataDir: target,
        // 网盘文件目录独立，系统数据目录迁移不改变现有 storage 位置
        storageDir: context.storageRoot,
        pluginsDir: context.pluginsDir,
      });
    } else if (kind === 'storage') {
      if (input.migrate) {
        await cp(context.storageRoot, target, {
          recursive: true,
          force: true,
        });
      } else {
        await initializeStorage(context, target);
      }

      saveAppPaths({
        dataDir: context.dataDir,
        storageDir: target,
        pluginsDir: context.pluginsDir,
      });
    } else {
      if (input.migrate) {
        await cp(context.pluginsDir, target, { recursive: true, force: true });
      }
      saveAppPaths({
        dataDir: context.dataDir,
        storageDir: context.storageRoot,
        pluginsDir: target,
      });
    }
  } catch (error) {
    // 配置尚未写入，保持原路径；恢复原服务
    if (serverStatus.running) {
      await context.server.start(serverStatus.port).catch(() => {});
    }
    if (frpWasRunning) {
      await context.frp.start().catch(() => {});
    }
    if (pluginsWereRunning) {
      await context.services.plugins.startAll().catch(() => {});
    }
    throw error;
  }

  context.services.audit.record({
    actorType: 'admin',
    actorId: context.session.require().id,
    action: 'directory.change',
    result: 'success',
    targetType:
      kind === 'data'
        ? 'data-directory'
        : kind === 'storage'
          ? 'storage-directory'
          : 'plugins-directory',
    targetPath: target,
    detail: { migrate: input.migrate, previous: current },
  });

  scheduleRelaunch(context);
  return { restarting: true };
}
