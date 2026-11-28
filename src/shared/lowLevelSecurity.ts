/** Low-level safety controls that sit outside the WAF policy engine. */
export interface LowLevelSecurity {
  apiRateLimit: number;
  uploadRateLimit: number;
  shareRateLimit: number;
  shareDownloadRateLimit: number;
  extractRateLimit: number;
  compressRateLimit: number;
  scanRateLimit: number;
  registrationLimit: number;

  maxFileBytes: number;
  maxAvatarBytes: number;
  maxListEntries: number;
  maxBatchPaths: number;
  maxTextPreviewBytes: number;
  maxConcurrentExtractions: number;
  maxConcurrentScans: number;
  maxConcurrentHeavyPreviews: number;
  maxConcurrentPreviewsPerUser: number;
  maxLogSizeMB: number;
  clamavMaxBytes: number;
  clamavTimeoutSeconds: number;
  uploadQueueConcurrency: number;
  uploadDrainBytes: number;
  shareMaxSeconds: number;

  extractMaxFiles: number;
  extractTotalBytes: number;
  extractEntryBytes: number;
  extractCompressionRatio: number;
  extractTimeoutSeconds: number;

  pluginPackageBytes: number;
  pluginPackageEntries: number;
  pluginUncompressedBytes: number;
  pluginEntryBytes: number;
  pluginCompressionRatio: number;

  compressMaxFiles: number;
  compressMaxBytes: number;
  compressTimeoutSeconds: number;
  compressConcurrent: number;

  archivePreviewMaxEntries: number;
  archivePreviewMaxBytes: number;
  archivePreviewTimeoutSeconds: number;

  guestMaxConcurrent: number;
  guestLinkTtlHours: number;

  sessionTtlHours: number;
  adminSessionTtlHours: number;
  adminInitTokenTtlHours: number;
  onlineWindowSeconds: number;
  proxyTimeoutMs: number;
  frpHealthTimeoutSeconds: number;
  frpHealthIntervalSeconds: number;
  tlsMinVersion: 'TLSv1.2' | 'TLSv1.3';
  headersTimeoutMs: number;
  requestTimeoutMs: number;

  pluginStartTimeoutMs: number;
  pluginRequestTimeoutMs: number;
}

export const DEFAULT_LOW_LEVEL_SECURITY: LowLevelSecurity = {
  apiRateLimit: 600,
  uploadRateLimit: 120,
  shareRateLimit: 10,
  shareDownloadRateLimit: 60,
  extractRateLimit: 10,
  compressRateLimit: 10,
  scanRateLimit: 10,
  registrationLimit: 2,

  maxFileBytes: 2 * 1024 ** 3,
  maxAvatarBytes: 900_000,
  maxListEntries: 5_000,
  maxBatchPaths: 100,
  maxTextPreviewBytes: 512 * 1024,
  maxConcurrentExtractions: 10,
  maxConcurrentScans: 10,
  maxConcurrentHeavyPreviews: 10,
  maxConcurrentPreviewsPerUser: 10,
  maxLogSizeMB: 100,
  clamavMaxBytes: 100 * 1024 ** 2,
  clamavTimeoutSeconds: 300,
  uploadQueueConcurrency: 10,
  uploadDrainBytes: 16 * 1024 * 1024,
  shareMaxSeconds: 7_200,

  extractMaxFiles: 10_000,
  extractTotalBytes: 50 * 1024 ** 3,
  extractEntryBytes: 2 * 1024 ** 3,
  extractCompressionRatio: 1_000,
  extractTimeoutSeconds: 300,

  pluginPackageBytes: 20 * 1024 * 1024,
  pluginPackageEntries: 2_000,
  pluginUncompressedBytes: 64 * 1024 * 1024,
  pluginEntryBytes: 16 * 1024 * 1024,
  pluginCompressionRatio: 100,

  compressMaxFiles: 100,
  compressMaxBytes: 10 * 1024 ** 3,
  compressTimeoutSeconds: 300,
  compressConcurrent: 2,

  archivePreviewMaxEntries: 2_000,
  archivePreviewMaxBytes: 512 * 1024 * 1024,
  archivePreviewTimeoutSeconds: 60,

  guestMaxConcurrent: 5,
  guestLinkTtlHours: 24,

  sessionTtlHours: 168,
  adminSessionTtlHours: 4,
  adminInitTokenTtlHours: 24,
  onlineWindowSeconds: 300,
  proxyTimeoutMs: 3_000,
  frpHealthTimeoutSeconds: 3,
  frpHealthIntervalSeconds: 10,
  tlsMinVersion: 'TLSv1.2',
  headersTimeoutMs: 60_000,
  requestTimeoutMs: 300_000,

  pluginStartTimeoutMs: 10_000,
  pluginRequestTimeoutMs: 15_000,
};

export function parseLowLevelSecurity(raw: string | null | undefined): LowLevelSecurity {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Partial<LowLevelSecurity>;
    const result = { ...DEFAULT_LOW_LEVEL_SECURITY };
    for (const key of Object.keys(DEFAULT_LOW_LEVEL_SECURITY) as Array<keyof LowLevelSecurity>) {
      const value = parsed[key];
      if (typeof value === typeof DEFAULT_LOW_LEVEL_SECURITY[key]) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_LOW_LEVEL_SECURITY };
  }
}

export function clampLowLevelSecurity(input: Partial<LowLevelSecurity>): LowLevelSecurity {
  const base = { ...DEFAULT_LOW_LEVEL_SECURITY };
  const out = { ...base };
  const numberKeys: Array<keyof LowLevelSecurity> = [
    'apiRateLimit', 'uploadRateLimit', 'shareRateLimit', 'shareDownloadRateLimit',
    'extractRateLimit', 'compressRateLimit', 'scanRateLimit', 'registrationLimit', 'maxFileBytes', 'maxAvatarBytes',
    'maxListEntries', 'maxBatchPaths', 'maxTextPreviewBytes', 'maxConcurrentExtractions',
    'maxConcurrentScans', 'maxConcurrentHeavyPreviews', 'maxConcurrentPreviewsPerUser', 'maxLogSizeMB', 'clamavMaxBytes', 'clamavTimeoutSeconds', 'uploadQueueConcurrency',
    'uploadDrainBytes', 'shareMaxSeconds', 'extractMaxFiles', 'extractTotalBytes',
    'extractEntryBytes', 'extractCompressionRatio',
    'extractTimeoutSeconds', 'pluginPackageBytes', 'pluginPackageEntries',
    'pluginUncompressedBytes', 'pluginEntryBytes', 'pluginCompressionRatio',
    'compressMaxFiles', 'compressMaxBytes', 'compressTimeoutSeconds', 'compressConcurrent',
    'archivePreviewMaxEntries', 'archivePreviewMaxBytes', 'archivePreviewTimeoutSeconds',
    'guestMaxConcurrent', 'guestLinkTtlHours',
    'sessionTtlHours', 'adminSessionTtlHours', 'adminInitTokenTtlHours', 'onlineWindowSeconds',
    'proxyTimeoutMs', 'frpHealthTimeoutSeconds', 'frpHealthIntervalSeconds',
    'headersTimeoutMs', 'requestTimeoutMs', 'pluginStartTimeoutMs', 'pluginRequestTimeoutMs',
  ];
  for (const key of numberKeys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && (value > 0 || (key === 'guestLinkTtlHours' && value === 0))) {
      (out as Record<string, unknown>)[key] = Math.trunc(value);
    }
  }
  const bounded: Array<[keyof LowLevelSecurity, number, number]> = [
    ['maxAvatarBytes', 1_024, 5 * 1024 * 1024],
    ['extractMaxFiles', 1, 100_000],
    ['extractTotalBytes', 1, 1024 ** 4],
    ['extractEntryBytes', 1, 1024 ** 4],
    ['extractCompressionRatio', 1, 10_000],
    ['extractTimeoutSeconds', 10, 3_600],
    ['pluginPackageBytes', 1, 100 * 1024 * 1024],
    ['shareMaxSeconds', 30, 7_200],
    ['pluginPackageEntries', 1, 10_000],
    ['pluginUncompressedBytes', 1, 512 * 1024 * 1024],
    ['pluginEntryBytes', 1, 128 * 1024 * 1024],
    ['pluginCompressionRatio', 1, 1_000],
    ['compressMaxFiles', 1, 100_000],
    ['compressMaxBytes', 1, 1024 ** 4],
    ['compressTimeoutSeconds', 10, 3_600],
    ['compressConcurrent', 1, 100],
    ['archivePreviewMaxEntries', 1, 100_000],
    ['archivePreviewMaxBytes', 1, 1024 ** 4],
    ['archivePreviewTimeoutSeconds', 5, 600],
    ['guestMaxConcurrent', 1, 100],
    ['guestLinkTtlHours', 0, 168],
    ['maxConcurrentHeavyPreviews', 1, 1_000],
    ['maxConcurrentPreviewsPerUser', 1, 1_000],
    ['maxLogSizeMB', 1, 100_000],
    ['adminSessionTtlHours', 1, 168],
    ['adminInitTokenTtlHours', 1, 168],
  ];
  for (const [key, min, max] of bounded) {
    const value = out[key] as number;
    (out as Record<string, unknown>)[key] = Math.min(max, Math.max(min, value));
  }
  if (input.tlsMinVersion === 'TLSv1.2' || input.tlsMinVersion === 'TLSv1.3') {
    out.tlsMinVersion = input.tlsMinVersion;
  }
  return out;
}
