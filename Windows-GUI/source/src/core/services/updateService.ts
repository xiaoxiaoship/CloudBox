import type { SettingsService } from './settingsService.ts';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  downloadUrl: string;
}

export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateError';
  }
}

interface GitHubRelease {
  tag_name?: unknown;
  body?: unknown;
  html_url?: unknown;
}

interface CacheEntry {
  repo: string;
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

  async check(currentVersion: string): Promise<UpdateCheckResult> {
    const repo = this.settings.get('system.updateRepo').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new UpdateError('更新仓库配置无效，应为 owner/repo');
    }

    if (this.cache !== null && this.cache.repo === repo && this.now() - this.cache.checkedAt < CHECK_INTERVAL_MS) {
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

    const result: UpdateCheckResult = {
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion: stripV(currentVersion),
      latestVersion,
      releaseNotes: typeof release.body === 'string' ? release.body : '',
      downloadUrl:
        typeof release.html_url === 'string'
          ? release.html_url
          : `https://github.com/${repo}/releases/latest`,
    };

    this.cache = { repo, checkedAt: this.now(), result };
    return result;
  }
}
