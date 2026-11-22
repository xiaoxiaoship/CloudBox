import type { SettingsService } from './settingsService.ts';

export type UpdateMode = 'gui' | 'server';

export interface UpdateAsset {
  name: string;
  url: string;
  size: number | null;
  digest: string | null;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  assetName?: string;
  assetUrl?: string;
  assetSize?: number | null;
  assetDigest?: string | null;
}

export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateError';
  }
}

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  body?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

interface CacheEntry {
  repo: string;
  mode: UpdateMode;
  checkedAt: number;
  result: UpdateCheckResult;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000;

function stripV(value: string): string {
  return value.trim().replace(/^v/i, '');
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): { core: number[]; pre: string } => {
    const [corePart = '0', pre = ''] = stripV(value).split('-', 2);
    return {
      core: corePart.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre,
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
    const diff = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === '') return 1;
  if (b.pre === '') return -1;
  return a.pre.localeCompare(b.pre);
}

function assetPattern(mode: UpdateMode): RegExp {
  return mode === 'server'
    ? /^CloudBox-Server-.+-x64\.exe$/i
    : /^CloudBox-Setup-.+-x64\.exe$/i;
}

function parseAsset(value: unknown): UpdateAsset | null {
  if (typeof value !== 'object' || value === null) return null;
  const asset = value as GitHubAsset;
  if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') return null;
  return {
    name: asset.name,
    url: asset.browser_download_url,
    size: typeof asset.size === 'number' ? asset.size : null,
    digest: typeof asset.digest === 'string' ? asset.digest : null,
  };
}

export class UpdateService {
  private readonly settings: SettingsService;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private cache: CacheEntry | null = null;

  constructor(options: {
    settings: SettingsService;
    fetchImpl?: typeof fetch;
    now?: () => number;
  }) {
    this.settings = options.settings;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async check(currentVersion: string, mode: UpdateMode = 'gui'): Promise<UpdateCheckResult> {
    const repo = this.settings.get('system.updateRepo').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new UpdateError('更新仓库配置无效，应为 owner/repo');
    }

    if (this.cache !== null && this.cache.repo === repo && this.cache.mode === mode && this.now() - this.cache.checkedAt < CHECK_INTERVAL_MS) {
      return this.cache.result;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'CloudBox-Update-Checker',
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new UpdateError(
        `无法连接 GitHub Releases：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new UpdateError(`GitHub Releases 请求失败（HTTP ${response.status}）`);
    }

    const release = (await response.json()) as GitHubRelease;
    const latestVersion = typeof release.tag_name === 'string' ? stripV(release.tag_name) : '';
    if (!latestVersion) throw new UpdateError('GitHub Release 缺少 tag_name');

    const assets = Array.isArray(release.assets)
      ? release.assets.map(parseAsset).filter((asset): asset is UpdateAsset => asset !== null)
      : [];
    const selected = assets.find((asset) => assetPattern(mode).test(asset.name));

    const result: UpdateCheckResult = {
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion: stripV(currentVersion),
      latestVersion,
      releaseNotes: typeof release.body === 'string' ? release.body : '',
      downloadUrl:
        typeof release.html_url === 'string'
          ? release.html_url
          : `https://github.com/${repo}/releases/latest`,
      assetName: selected?.name,
      assetUrl: selected?.url,
      assetSize: selected?.size ?? null,
      assetDigest: selected?.digest ?? null,
    };

    this.cache = { repo, mode, checkedAt: this.now(), result };
    return result;
  }

  async downloadAsset(
    asset: { url: string; size: number | null; digest: string | null },
    destination: string,
    onProgress: (downloaded: number, total: number | null) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.fetchImpl(asset.url, {
      headers: { 'User-Agent': 'CloudBox-Update-Downloader' },
      signal: signal ?? AbortSignal.timeout(30 * 60_000),
    });
    if (!response.ok || response.body === null) {
      throw new UpdateError(`下载更新失败（HTTP ${response.status}）`);
    }

    const total = asset.size ?? (Number(response.headers.get('content-length') ?? 0) || null);
    const { createWriteStream } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { rm } = await import('node:fs/promises');
    const stream = createWriteStream(destination, { mode: 0o700 });
    const hash = createHash('sha256');
    const reader = response.body.getReader();
    let downloaded = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        downloaded += value.byteLength;
        hash.update(value);
        if (!stream.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => stream.once('drain', resolve));
        }
        onProgress(downloaded, total);
      }
      await new Promise<void>((resolve, reject) => {
        stream.end((error?: Error | null) => error ? reject(error) : resolve());
      });
    } catch (error) {
      stream.destroy();
      await rm(destination, { force: true }).catch(() => {});
      throw new UpdateError(`下载更新失败：${error instanceof Error ? error.message : String(error)}`);
    }

    if (asset.size !== null && downloaded !== asset.size) {
      await rm(destination, { force: true }).catch(() => {});
      throw new UpdateError(`更新文件大小不匹配（${downloaded}/${asset.size}）`);
    }
    if (asset.digest !== null) {
      const actual = `sha256:${hash.digest('hex')}`;
      if (actual.toLowerCase() !== asset.digest.toLowerCase()) {
        await rm(destination, { force: true }).catch(() => {});
        throw new UpdateError('更新文件 SHA-256 校验失败');
      }
    }
  }
}
