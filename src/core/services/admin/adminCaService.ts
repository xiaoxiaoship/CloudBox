import type { CaInfo, CertificateInfo } from '../../../shared/ipcTypes.ts';
import type { CaManager } from '../../../main/caManager.ts';
import type { TlsManager } from '../../../main/tlsManager.ts';

/** Shared CA/TLS adapter for Electron IPC and the headless admin HTTP API. */
export class AdminCaService {
  private readonly ca: CaManager;
  private readonly tls: TlsManager;

  constructor(options: { ca: CaManager; tls: TlsManager }) {
    this.ca = options.ca;
    this.tls = options.tls;
  }

  info(): CaInfo { return this.ca.getCAInfo(); }
  async create(): Promise<CaInfo> { return this.ca.createPrivateCA(); }
  async install(): Promise<CaInfo> { return this.ca.installCA(); }
  async uninstall(): Promise<CaInfo> { return this.ca.uninstallCA(); }
  async issueServerCert(extraHosts: string): Promise<CertificateInfo> {
    return this.ca.issueServerCert(extraHosts);
  }
  certificate(): CertificateInfo { return this.tls.getInfo(); }
  async importCertificate(kind: 'cert' | 'key', fileName: string, content: string): Promise<CertificateInfo> {
    const buffer = Buffer.from(content, 'base64');
    return this.tls.importContent(buffer, kind, fileName);
  }
  async exportClientCert(destinationPath: string) { return this.ca.issueClientCert(destinationPath); }
}
