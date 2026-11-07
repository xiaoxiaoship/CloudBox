import { existsSync } from 'node:fs';
import path from 'node:path';

export const isLinux = process.platform === 'linux';

/** Linux 优先使用随包/系统 PATH 的 7za，不再拼接 .exe。 */
export function resolveSevenZipBinary(): string {
  const candidates = [
    path.join(process.cwd(), 'resources', 'bin', '7za'),
    path.join(process.cwd(), 'node_modules', '7zip-bin', 'linux', process.arch, '7za'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return '7za';
}

export function resolveFrpcBinary(): string {
  const local = path.join(process.cwd(), 'resources', 'bin', 'frpc');
  return existsSync(local) ? local : 'frpc';
}

export function defaultClamscanPath(): string {
  return isLinux ? '/usr/bin/clamscan' : '';
}
