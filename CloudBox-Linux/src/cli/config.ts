import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from '../server/headless.ts';

export interface CliConfig {
  port: number;
  host: string;
}

const DEFAULTS: CliConfig = { port: 8686, host: '0.0.0.0' };

export function configFile(portable: boolean, dataDir?: string): string {
  return path.join(resolveDataDir(portable, dataDir), 'config.json');
}

export function readConfig(portable: boolean, dataDir?: string): CliConfig {
  const file = configFile(portable, dataDir);
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<CliConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(
  portable: boolean,
  dataDir: string | undefined,
  patch: Partial<CliConfig>,
): CliConfig {
  const next = { ...readConfig(portable, dataDir), ...patch };
  const file = configFile(portable, dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
