export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function isLogLevel(value: string): value is LogLevel {
  return value in PRIORITY;
}

type Meta = Record<string, unknown>;

function emit(level: LogLevel, message: string, meta?: Meta): void {
  if (PRIORITY[level] < PRIORITY[minLevel]) return;

  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';

  if (level === 'error') {
    console.error(line + suffix);
  } else if (level === 'warn') {
    console.warn(line + suffix);
  } else {
    console.log(line + suffix);
  }
}

/** 极简结构化日志；阶段 4 接入 Electron 后可无痛替换为文件落盘实现 */
export const logger = {
  debug: (message: string, meta?: Meta) => emit('debug', message, meta),
  info: (message: string, meta?: Meta) => emit('info', message, meta),
  warn: (message: string, meta?: Meta) => emit('warn', message, meta),
  error: (message: string, meta?: Meta) => emit('error', message, meta),
};
