let uploadedBytes = 0;
let downloadedBytes = 0;

export function recordUploadBytes(bytes: number): void {
  if (bytes > 0) uploadedBytes += bytes;
}

export function recordDownloadBytes(bytes: number): void {
  if (bytes > 0) downloadedBytes += bytes;
}

export function getTrafficSnapshot(): { uploadedBytes: number; downloadedBytes: number } {
  return { uploadedBytes, downloadedBytes };
}

export function resetTraffic(): void {
  uploadedBytes = 0;
  downloadedBytes = 0;
}
