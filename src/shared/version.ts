import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

let cachedVersion: string | null = null;

/** 读取 package.json 版本号；失败时回退 0.0.0，绝不让版本读取阻断服务启动 */
export function getAppVersion(): string {
  if (cachedVersion !== null) return cachedVersion;

  try {
    const raw = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version?: unknown };
    cachedVersion = typeof raw.version === 'string' ? raw.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }

  return cachedVersion;
}
