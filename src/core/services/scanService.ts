import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ScanRepository, ScanStatus } from '../db/repositories/scanRepo.ts';
import type { SessionUser } from '../types/models.ts';
import type { AuditService } from './auditService.ts';
import {
  FILE_ERROR,
  FileServiceError,
  type DownloadTarget,
  type FileService,
  type RequestContext,
} from './fileService.ts';
import type { SettingsService } from './settingsService.ts';
import type { TaskService } from './taskService.ts';

export const SCAN_MAX_API_BYTES = 32 * 1024 * 1024;

export interface VirusTotalResult {
  positives: number;
  details?: unknown;
}

export interface VirusTotalClient {
  lookup(hash: string, apiKey: string): Promise<VirusTotalResult>;
}

export interface LocalScanResult {
  infected: boolean;
  details?: unknown;
}

export interface LocalScanner {
  scan(filePath: string, localPath: string): Promise<LocalScanResult>;
}

export interface ScanResult {
  status: 'clean' | 'infected';
  sha256: string;
  engine: string;
  details: unknown;
}

const defaultVirusTotalClient: VirusTotalClient = {
  async lookup(hash, apiKey) {
    const response = await fetch(
      `https://www.virustotal.com/api/v3/files/${encodeURIComponent(hash)}`,
      {
        headers: { 'x-apikey': apiKey },
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (response.status === 404) {
      return { positives: 0, details: { notFound: true } };
    }
    if (!response.ok) {
      throw new Error(`VirusTotal 返回 HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      data?: {
        attributes?: {
          last_analysis_stats?: { positives?: number };
          meaningful_name?: string;
        };
      };
    };
    const positives = body.data?.attributes?.last_analysis_stats?.positives ?? 0;
    return {
      positives,
      details: {
        name: body.data?.attributes?.meaningful_name ?? null,
        stats: body.data?.attributes?.last_analysis_stats ?? null,
      },
    };
  },
};

function resolveClamscanBinary(localPath: string): string | null {
  const root = localPath.trim();
  if (!root) return null;

  try {
    if (statSync(root).isFile()) return root;
  } catch {
    return null;
  }

  for (const candidate of [
    path.join(root, 'clamscan.exe'),
    path.join(root, 'clamscan'),
    path.join(root, 'clamdscan.exe'),
    path.join(root, 'clamdscan'),
    path.join(root, 'bin', 'clamscan.exe'),
    path.join(root, 'bin', 'clamscan'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const defaultLocalScanner: LocalScanner = {
  async scan(filePath, localPath) {
    const binary = resolveClamscanBinary(localPath);
    if (binary === null) {
      throw new Error('未在配置的 ClamAV 目录中找到 clamscan/clamdscan');
    }

    const module = (await import('clamscan')) as unknown as {
      default?: new () => {
        init: (options: Record<string, unknown>) => Promise<{
          isInfected: (target: string) => Promise<{
            isInfected: boolean;
            viruses?: string[];
          }>;
        }>;
      };
    };
    const NodeClam = module.default;
    if (NodeClam === undefined) throw new Error('clamscan 模块加载失败');

    const scanner = await new NodeClam().init({
      preference: 'clamscan',
      clamscan: { path: binary, active: true, scanArchives: true },
      clamdscan: { active: false },
    });
    const result = await scanner.isInfected(filePath);
    return { infected: result.isInfected, details: { viruses: result.viruses ?? [] } };
  },
};

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/**
 * 双模式云查杀：
 *  - api：SHA-256 + VirusTotal（>32MB 拒绝）
 *  - local：调用 ClamAV 的 clamscan/clamdscan
 * 查杀结果写入 file_scans，下载/分享/解压由 FileService 统一强制拦截。
 */
export class ScanService {
  private readonly files: FileService;
  private readonly scans: ScanRepository;
  private readonly settings: SettingsService;
  private readonly tasks: TaskService;
  private readonly audit: AuditService;
  private readonly virusTotal: VirusTotalClient;
  private readonly localScanner: LocalScanner;
  private readonly now: () => number;

  constructor(options: {
    files: FileService;
    scans: ScanRepository;
    settings: SettingsService;
    tasks: TaskService;
    audit: AuditService;
    virusTotal?: VirusTotalClient;
    localScanner?: LocalScanner;
    now?: () => number;
  }) {
    this.files = options.files;
    this.scans = options.scans;
    this.settings = options.settings;
    this.tasks = options.tasks;
    this.audit = options.audit;
    this.virusTotal = options.virusTotal ?? defaultVirusTotalClient;
    this.localScanner = options.localScanner ?? defaultLocalScanner;
    this.now = options.now ?? Date.now;
  }

  async start(
    user: SessionUser,
    filePath: string,
    ctx: RequestContext,
  ): Promise<{ taskId: string }> {
    if (!this.settings.get('allow_user_scan')) {
      throw new FileServiceError(FILE_ERROR.FEATURE_DISABLED, '管理员已关闭安全查杀权限', 403);
    }
    if (!this.settings.get('scan.enabled')) {
      throw new FileServiceError(FILE_ERROR.FEATURE_DISABLED, '安全查杀总开关未开启', 403);
    }

    // 允许重新扫描已标记 infected 的文件，便于复核
    const target = await this.files.inspectFile(user, filePath, ctx, 'file.scan', {
      allowInfected: true,
    });
    const mode = this.settings.get('scan.mode');

    if (mode === 'api' && target.size > SCAN_MAX_API_BYTES) {
      throw new FileServiceError(
        FILE_ERROR.FILE_TOO_LARGE,
        'API 模式仅支持 32MB 以内的文件',
        413,
      );
    }

    const task = this.tasks.create(user.id, 'scan', 'scanning');
    void this.run(task.id, user, target, ctx);
    return { taskId: task.id };
  }

  private async run(
    taskId: string,
    user: SessionUser,
    target: DownloadTarget,
    ctx: RequestContext,
  ): Promise<void> {
    const mode = this.settings.get('scan.mode');

    try {
      let result: ScanResult;

      if (mode === 'api') {
        const apiKey = this.settings.get('scan.api_key').trim();
        if (!apiKey) throw new Error('未配置 VirusTotal API Key');
        const sha256 = await sha256File(target.absolutePath);
        const vt = await this.virusTotal.lookup(sha256, apiKey);
        result = {
          status: vt.positives > 0 ? 'infected' : 'clean',
          sha256,
          engine: 'virustotal',
          details: { positives: vt.positives, ...((vt.details as object | undefined) ?? {}) },
        };
      } else {
        const localPath = this.settings.get('scan.local_path').trim();
        if (!localPath) throw new Error('未配置 ClamAV 目录');
        const local = await this.localScanner.scan(target.absolutePath, localPath);
        result = {
          status: local.infected ? 'infected' : 'clean',
          sha256: await sha256File(target.absolutePath),
          engine: 'clamav',
          details: local.details ?? null,
        };
      }

      const status: ScanStatus = result.status;
      const scannedAt = this.now();
      this.scans.upsert({
        userId: user.id,
        filePath: target.relativePath,
        status,
        sha256: result.sha256,
        engine: result.engine,
        details: JSON.stringify(result.details),
        scannedAt,
      });

      this.tasks.update(taskId, {
        status: result.status,
        result: {
          filePath: target.relativePath,
          status: result.status,
          sha256: result.sha256,
          engine: result.engine,
          details: result.details,
        },
      });

      this.audit.record({
        actorType: 'user',
        actorId: user.id,
        action: 'file.scan',
        result: 'success',
        targetType: 'file',
        targetPath: target.relativePath,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
        detail: { status: result.status, engine: result.engine, sha256: result.sha256 },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 重新扫描失败时不能覆盖之前已确认的 infected 结论，否则会意外解锁下载。
      const previous = this.scans.get(user.id, target.relativePath);
      if (previous?.status !== 'infected') {
        this.scans.upsert({
          userId: user.id,
          filePath: target.relativePath,
          status: 'failed',
          sha256: null,
          engine: mode === 'api' ? 'virustotal' : 'clamav',
          details: JSON.stringify({ error: message }),
          scannedAt: this.now(),
        });
      }
      this.tasks.update(taskId, { status: 'failed', error: message });
      this.audit.record({
        actorType: 'user',
        actorId: user.id,
        action: 'file.scan',
        result: 'error',
        targetType: 'file',
        targetPath: target.relativePath,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
        detail: { message },
      });
    }
  }
}
