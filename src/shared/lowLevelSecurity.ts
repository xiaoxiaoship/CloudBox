/** Low-level safety controls that sit outside the WAF policy engine. */
export interface LowLevelSecurity {
  apiRateLimit: number;
  uploadRateLimit: number;
  shareRateLimit: number;
  shareDownloadRateLimit: number;
  extractRateLimit: number;
  scanRateLimit: number;
  registrationLimit: number;

  maxFileBytes: number;
  maxListEntries: number;
  maxBatchPaths: number;
  maxTextPreviewBytes: number;
  maxConcurrentExtractions: number;
  maxConcurrentScans: number;
  clamavMaxBytes: number;
  clamavTimeoutSeconds: number;
  uploadQueueConcurrency: number;
  uploadDrainBytes: number;
  shareMaxSeconds: number;

  sessionTtlHours: number;
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
  scanRateLimit: 10,
  registrationLimit: 2,

  maxFileBytes: 2 * 1024 ** 3,
  maxListEntries: 5_000,
  maxBatchPaths: 100,
  maxTextPreviewBytes: 512 * 1024,
  maxConcurrentExtractions: 10,
  maxConcurrentScans: 10,
  clamavMaxBytes: 100 * 1024 ** 2,
  clamavTimeoutSeconds: 300,
  uploadQueueConcurrency: 10,
  uploadDrainBytes: 16 * 1024 * 1024,
  shareMaxSeconds: 7_200,

  sessionTtlHours: 168,
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
    'extractRateLimit', 'scanRateLimit', 'registrationLimit', 'maxFileBytes',
    'maxListEntries', 'maxBatchPaths', 'maxTextPreviewBytes', 'maxConcurrentExtractions',
    'maxConcurrentScans', 'clamavMaxBytes', 'clamavTimeoutSeconds', 'uploadQueueConcurrency',
    'uploadDrainBytes', 'shareMaxSeconds', 'sessionTtlHours', 'onlineWindowSeconds',
    'proxyTimeoutMs', 'frpHealthTimeoutSeconds', 'frpHealthIntervalSeconds',
    'headersTimeoutMs', 'requestTimeoutMs', 'pluginStartTimeoutMs', 'pluginRequestTimeoutMs',
  ];
  for (const key of numberKeys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      (out as Record<string, unknown>)[key] = Math.trunc(value);
    }
  }
  if (input.tlsMinVersion === 'TLSv1.2' || input.tlsMinVersion === 'TLSv1.3') {
    out.tlsMinVersion = input.tlsMinVersion;
  }
  return out;
}
