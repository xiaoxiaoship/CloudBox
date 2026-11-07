import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { openDatabase } from '../core/db/connection.ts';
import { migrate } from '../core/db/migrator.ts';
import { createCoreServices, type CoreServices } from '../core/container.ts';
import { createApp } from './app.ts';

export interface HeadlessOptions {
  portable?: boolean;
  dataDir?: string;
  port?: number;
  host?: string;
}

export function resolveDataDir(portable = false, explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.CLOUDBOX_DATA_DIR) return path.resolve(process.env.CLOUDBOX_DATA_DIR);
  if (portable) return path.resolve(process.cwd(), 'data');
  return process.platform === 'linux' ? '/var/lib/cloudbox' : path.resolve(process.cwd(), 'data');
}

export function openServices(options: HeadlessOptions = {}): {
  services: CoreServices;
  dataDir: string;
  close: () => void;
} {
  const dataDir = resolveDataDir(options.portable, options.dataDir);
  const storageRoot = path.join(dataDir, 'storage');
  const tempDir = path.join(dataDir, 'tmp', 'uploads');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(storageRoot, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  const db = openDatabase({ file: path.join(dataDir, 'cloudbox.db') });
  migrate(db);
  const services = createCoreServices({
    db,
    storageRoot,
    tempDir,
    pluginRoot: path.join(dataDir, 'plugins'),
    pluginChildScript: path.resolve('src/plugin-runtime/child.cjs'),
    secretPath: path.join(dataDir, 'ai-secret.key'),
  });
  return {
    services,
    dataDir,
    close: () => {
      void services.plugins.stopAll();
      db.close();
    },
  };
}

export async function startHeadless(options: HeadlessOptions = {}): Promise<{
  server: Server;
  services: CoreServices;
  dataDir: string;
  port: number;
}> {
  const opened = openServices(options);
  const port = options.port ?? Number(process.env.PORT ?? 8686);
  const host = options.host ?? '0.0.0.0';
  const webDist = existsSync(path.resolve('dist/web/index.html')) ? path.resolve('dist/web') : null;
  const app = createApp({
    services: opened.services,
    version: '0.1.0-linux',
    webDist,
  });
  await opened.services.plugins.startAll();
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.once('error', reject);
  });
  console.log(`CloudBox Linux listening on http://${host}:${port}`);
  return { server, services: opened.services, dataDir: opened.dataDir, port };
}
