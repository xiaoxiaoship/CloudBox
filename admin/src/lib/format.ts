export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '不限量';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDate(timestamp: number | null): string {
  if (timestamp === null) return '从未登录';
  return new Date(timestamp).toLocaleString(document.documentElement.lang.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function quotaToBytes(value: number, unit: 'MB' | 'GB'): number {
  return Math.round(value * (unit === 'GB' ? 1024 ** 3 : 1024 ** 2));
}

export function bytesToInput(bytes: number | null): { value: string; unit: 'MB' | 'GB' } {
  if (bytes === null) return { value: '', unit: 'GB' };
  if (bytes === 0) return { value: '0', unit: 'GB' };
  if (bytes % 1024 ** 3 === 0) return { value: String(bytes / 1024 ** 3), unit: 'GB' };
  return { value: String(Math.round((bytes / 1024 ** 2) * 10) / 10), unit: 'MB' };
}
