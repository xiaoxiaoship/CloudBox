import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface AppPaths {
  dataDir: string;
  storageDir: string;
  pluginsDir: string;
}

/**
 * 路径配置放在 Electron userData 下，不跟随系统数据目录移动：
 * 这样修改 dataDir 后，下次启动仍能读到新位置。
 */
export function pathsConfigFile(): string {
  if (process.env.CLOUDBOX_PATHS_FILE) {
    return path.resolve(process.env.CLOUDBOX_PATHS_FILE);
  }
  return path.join(app.getPath('userData'), 'cloudbox-paths.json');
}

export function loadAppPaths(): AppPaths {
  const envData = process.env.CLOUDBOX_DATA_DIR;
  if (envData) {
    const dataDir = path.resolve(envData);
    return {
      dataDir,
      storageDir: process.env.CLOUDBOX_STORAGE_DIR
        ? path.resolve(process.env.CLOUDBOX_STORAGE_DIR)
        : path.join(dataDir, 'storage'),
      pluginsDir: process.env.CLOUDBOX_PLUGINS_DIR
        ? path.resolve(process.env.CLOUDBOX_PLUGINS_DIR)
        : path.join(app.getPath('userData'), 'plugins'),
    };
  }

  const file = pathsConfigFile();
  let parsed: Partial<AppPaths> = {};

  if (existsSync(file)) {
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppPaths>;
    } catch {
      // 损坏的配置回退默认值
      parsed = {};
    }
  }

  const dataDir = path.resolve(parsed.dataDir ?? app.getPath('userData'));
  const storageDir = path.resolve(parsed.storageDir ?? path.join(dataDir, 'storage'));
  const pluginsDir = path.resolve(
    parsed.pluginsDir ?? path.join(app.getPath('userData'), 'plugins'),
  );

  return { dataDir, storageDir, pluginsDir };
}

export function saveAppPaths(paths: AppPaths): void {
  const file = pathsConfigFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${Date.now()}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ dataDir: paths.dataDir, storageDir: paths.storageDir, pluginsDir: paths.pluginsDir }, null, 2)}\n`,
    'utf8',
  );
  renameSync(temporary, file);
}
