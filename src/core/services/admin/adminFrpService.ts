import type { FrpService } from '../../../main/frpService.ts';
import type { FrpConfig, FrpStatus } from '../../../shared/ipcTypes.ts';
import type { SettingsService } from '../settingsService.ts';

/** Shared frp adapter for Electron IPC and the headless admin HTTP API. */
export class AdminFrpService {
  private readonly frp: FrpService;
  private readonly settings: SettingsService;

  constructor(options: { frp: FrpService; settings: SettingsService }) {
    this.frp = options.frp;
    this.settings = options.settings;
  }

  status(): FrpStatus {
    return this.frp.getStatus();
  }

  async saveConfig(config: FrpConfig): Promise<FrpStatus> {
    const status = await this.frp.setConfig(config);
    this.settings.set('frp.serverAddr', config.serverAddr, null);
    this.settings.set('frp.serverPort', config.serverPort, null);
    this.settings.set('frp.remotePort', config.remotePort, null);
    this.settings.set('frp.token', config.token, null);
    this.settings.set('frp.user', config.user, null);
    this.settings.set('frp.proxyName', config.proxyName, null);
    this.settings.set('frp.tunnelType', config.tunnelType, null);
    this.settings.set('frp.customDomain', config.customDomain, null);
    this.settings.set('frp.proxyProtocol', config.proxyProtocol, null);
    this.settings.set('frp.healthCheckMux', config.healthCheckMux, null);
    return status;
  }

  async start(): Promise<FrpStatus> {
    const status = await this.frp.start();
    this.settings.set('frp.enabled', true, null);
    return status;
  }

  async stop(): Promise<FrpStatus> {
    const status = await this.frp.stop();
    this.settings.set('frp.enabled', false, null);
    return status;
  }

  async restart(): Promise<FrpStatus> {
    const status = await this.frp.restart();
    this.settings.set('frp.enabled', true, null);
    return status;
  }

  getSync(): { enabled: boolean } {
    return { enabled: this.settings.get('frp.syncWithServer') };
  }

  setSync(enabled: boolean): { enabled: boolean } {
    this.settings.set('frp.syncWithServer', enabled, null);
    return { enabled };
  }
}
