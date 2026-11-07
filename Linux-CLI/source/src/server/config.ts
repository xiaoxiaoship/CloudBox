import path from 'node:path';
import { z } from 'zod';
import type { LogLevel } from '../shared/logger.ts';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65_535).default(8686),
  BIND: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface ServerConfig {
  port: number;
  bind: string;
  dataDir: string;
  dbFile: string;
  storageRoot: string;
  tempDir: string;
  logLevel: LogLevel;
}

/**
 * 从环境变量加载配置（Electron 阶段会改为从 settings 表注入，这里保留同构接口）。
 * 校验失败直接抛错，避免带病启动。
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`服务配置无效：${detail}`);
  }

  const { PORT, BIND, DATA_DIR, LOG_LEVEL } = parsed.data;
  const dataDir = path.resolve(DATA_DIR ?? path.join(process.cwd(), 'data'));

  return {
    port: PORT,
    bind: BIND,
    dataDir,
    dbFile: path.join(dataDir, 'cloudbox.db'),
    storageRoot: path.join(dataDir, 'storage'),
    tempDir: path.join(dataDir, 'tmp', 'uploads'),
    logLevel: LOG_LEVEL,
  };
}
