export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
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

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  return date.toLocaleString(document.documentElement.lang.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function isImageName(name: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileExtension(name));
}

export function isPdfName(name: string): boolean {
  return fileExtension(name) === 'pdf';
}

export function isOfficeName(name: string): boolean {
  return ['docx', 'xlsx', 'pptx'].includes(fileExtension(name));
}

export function isVideoName(name: string): boolean {
  return ['mp4', 'webm', 'ogg'].includes(fileExtension(name));
}

export function isArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return ['.zip', '.7z', '.rar', '.tar.gz', '.tgz'].some((extension) =>
    lower.endsWith(extension),
  );
}

export function isAudioName(name: string): boolean {
  return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(fileExtension(name));
}

export function quotaPercent(usedBytes: number, quotaBytes: number | null): number {
  if (quotaBytes === null || quotaBytes <= 0) return 0;
  return Math.min(100, Math.max(0, (usedBytes / quotaBytes) * 100));
}
