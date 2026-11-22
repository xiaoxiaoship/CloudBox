import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface HeadlessPaths {
  dataDir: string;
  storageDir: string;
  pluginsDir: string;
}

export function bootstrapRoot(): string {
  return process.env.CLOUDBOX_PATHS_ROOT
    ? path.resolve(process.env.CLOUDBOX_PATHS_ROOT)
    : path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'CloudBox');
}

export function pathsFile(): string {
  return process.env.CLOUDBOX_PATHS_FILE
    ? path.resolve(process.env.CLOUDBOX_PATHS_FILE)
    : path.join(bootstrapRoot(), 'cloudbox-paths.json');
}

export function pathsAreEnvLocked(): boolean {
  return Boolean(process.env.CLOUDBOX_DATA_DIR || process.env.CLOUDBOX_STORAGE_DIR || process.env.CLOUDBOX_PLUGINS_DIR);
}

export function loadHeadlessPaths(): HeadlessPaths {
  const root = bootstrapRoot();
  if (process.env.CLOUDBOX_DATA_DIR) {
    const dataDir = path.resolve(process.env.CLOUDBOX_DATA_DIR);
    return {
      dataDir,
      storageDir: process.env.CLOUDBOX_STORAGE_DIR
        ? path.resolve(process.env.CLOUDBOX_STORAGE_DIR)
        : path.join(dataDir, 'storage'),
      pluginsDir: process.env.CLOUDBOX_PLUGINS_DIR
        ? path.resolve(process.env.CLOUDBOX_PLUGINS_DIR)
        : path.join(dataDir, 'plugins'),
    };
  }

  let parsed: Partial<HeadlessPaths> = {};
  const file = pathsFile();
  if (existsSync(file)) {
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<HeadlessPaths>;
    } catch {
      parsed = {};
    }
  }

  const dataDir = path.resolve(parsed.dataDir ?? root);
  return {
    dataDir,
    storageDir: path.resolve(parsed.storageDir ?? path.join(dataDir, 'storage')),
    pluginsDir: path.resolve(parsed.pluginsDir ?? path.join(dataDir, 'plugins')),
  };
}

export function saveHeadlessPaths(paths: HeadlessPaths): void {
  const file = pathsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${Date.now()}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({
      dataDir: paths.dataDir,
      storageDir: paths.storageDir,
      pluginsDir: paths.pluginsDir,
    }, null, 2)}\n`,
    'utf8',
  );
  renameSync(temporary, file);
}
