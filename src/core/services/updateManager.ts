import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { UpdateCheckResult, UpdateService, UpdateMode } from './updateService.ts';


import type { UpdatePhase, UpdateStatus } from '../../shared/ipcTypes.ts';

export interface UpdateManagerOptions {
  update: UpdateService;
  currentVersion: string;
  mode: UpdateMode;
  downloadDir: string;
  install: (filePath: string) => Promise<void> | void;
}

/**
 * Shared update lifecycle for the Electron GUI and the headless admin Web.
 * Downloads happen in the background; the UI polls status().
 */
export class UpdateManager {
  private readonly update: UpdateService;
  private readonly currentVersion: string;
  private readonly mode: UpdateMode;
  private readonly downloadDir: string;
  private readonly installHandler: UpdateManagerOptions['install'];
  private result: UpdateCheckResult | null = null;
  private filePath: string | null = null;
  private phase: UpdatePhase = 'idle';
  private progress = 0;
  private downloadedBytes = 0;
  private totalBytes: number | null = null;
  private error: string | null = null;
  private checkedAt: number | null = null;
  private task: Promise<void> | null = null;

  constructor(options: UpdateManagerOptions) {
    this.update = options.update;
    this.currentVersion = options.currentVersion;
    this.mode = options.mode;
    this.downloadDir = options.downloadDir;
    this.installHandler = options.install;
    mkdirSync(this.downloadDir, { recursive: true });
  }

  status(): UpdateStatus {
    return {
      phase: this.phase,
      progress: this.progress,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      currentVersion: this.currentVersion,
      latestVersion: this.result?.latestVersion ?? null,
      assetName: this.result?.assetName ?? null,
      error: this.error,
      checkedAt: this.checkedAt,
    };
  }

  async check(): Promise<UpdateCheckResult> {
    this.phase = 'checking';
    this.error = null;
    try {
      const result = await this.update.check(this.currentVersion, this.mode);
      this.result = result;
      this.checkedAt = Date.now();
      this.phase = result.hasUpdate ? 'available' : 'idle';
      return result;
    } catch (error) {
      this.phase = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async download(): Promise<UpdateStatus> {
    if (this.task !== null) return this.status();
    if (this.result === null || !this.result.hasUpdate) throw new Error('没有可下载的更新');
    if (!this.result.assetUrl || !this.result.assetName) {
      throw new Error('当前 Release 没有匹配的安装包资产');
    }
    if (this.filePath !== null) return this.status();

    const destination = path.join(this.downloadDir, this.result.assetName);
    this.phase = 'downloading';
    this.progress = 0;
    this.downloadedBytes = 0;
    this.totalBytes = this.result.assetSize ?? null;
    this.error = null;
    const task = this.update.downloadAsset(
      {
        url: this.result.assetUrl,
        size: this.result.assetSize ?? null,
        digest: this.result.assetDigest ?? null,
      },
      destination,
      (downloaded, total) => {
        this.downloadedBytes = downloaded;
        this.totalBytes = total;
        this.progress = total !== null && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
      },
    ).then(() => {
      this.filePath = destination;
      this.phase = 'downloaded';
      this.progress = 100;
    }).catch((error: unknown) => {
      this.phase = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => {
      this.task = null;
    });
    this.task = task;
    await task;
    return this.status();
  }

  async install(): Promise<UpdateStatus> {
    if (this.filePath === null) throw new Error('更新安装包尚未下载完成');
    this.phase = 'installing';
    this.error = null;
    try {
      await this.installHandler(this.filePath);
      this.phase = 'restarting';
      return this.status();
    } catch (error) {
      this.phase = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}
