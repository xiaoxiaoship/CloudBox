import type { ServerStatus } from '../../../main/serverController.ts';
import type { SettingsService } from '../settingsService.ts';

export interface AdminServerRuntime {
  getAdminPort(): number;
  getUserStatus(): ServerStatus;
  startUser(): Promise<void>;
  stopUser(): Promise<void>;
  restartUser(): Promise<void>;
  configureHttps(enabled: boolean): void;
  configureMtls(enabled: boolean): void;
}

/** Shared user-Web lifecycle adapter for Electron IPC and the headless HTTP API. */
export class AdminServerService {
  private readonly settings: SettingsService;
  private readonly runtime: AdminServerRuntime;

  constructor(options: { settings: SettingsService; runtime: AdminServerRuntime }) {
    this.settings = options.settings;
    this.runtime = options.runtime;
  }

  status(): ServerStatus {
    return this.runtime.getUserStatus();
  }

  async setOnline(enabled: boolean): Promise<ServerStatus> {
    if (enabled) await this.runtime.startUser();
    else await this.runtime.stopUser();
    return this.status();
  }

  async setPort(port: number): Promise<ServerStatus> {
    if (port === this.runtime.getAdminPort()) {
      throw new Error('用户 Web 端口不能与管理端端口相同');
    }
    this.settings.set('server.port', port, null);
    if (this.status().running) await this.runtime.restartUser();
    return this.status();
  }

  setAutoStart(enabled: boolean): ServerStatus {
    this.settings.set('server.autoStart', enabled, null);
    return this.status();
  }

  async applyNetwork(input: {
    protocol: 'http' | 'https';
    port: number;
    mtlsEnabled?: boolean;
  }): Promise<ServerStatus> {
    if (input.port === this.runtime.getAdminPort()) {
      throw new Error('用户 Web 端口不能与管理端端口相同');
    }
    const wasRunning = this.status().running;
    this.settings.set('server.port', input.port, null);
    this.settings.set('server.httpsEnabled', input.protocol === 'https', null);
    this.settings.set('server.mtlsEnabled', input.mtlsEnabled ?? false, null);
    this.runtime.configureHttps(input.protocol === 'https');
    this.runtime.configureMtls(input.mtlsEnabled ?? false);
    if (wasRunning) await this.runtime.restartUser();
    return this.status();
  }
}
