import { mkdirSync, readFileSync } from 'node:fs';
import { chmod, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';

export interface CertificateInfo {
  configured: boolean;
  certFileName: string | null;
  keyFileName: string | null;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  fingerprint: string | null;
  error: string | null;
}

export const TLS_ERROR = {
  NOT_CONFIGURED: 'TLS_NOT_CONFIGURED',
  INVALID_CERTIFICATE: 'TLS_INVALID_CERTIFICATE',
  INVALID_FILE: 'TLS_INVALID_FILE',
} as const;

export class TlsError extends Error {
  readonly code: (typeof TLS_ERROR)[keyof typeof TLS_ERROR];

  constructor(code: (typeof TLS_ERROR)[keyof typeof TLS_ERROR], message: string) {
    super(message);
    this.name = 'TlsError';
    this.code = code;
  }
}

/**
 * 证书存储：data/config/ssl/server.crt + server.key。
 * 导入时先写临时文件再原子替换；启用 HTTPS 前用 tls.createSecureContext 校验证书与私钥是否匹配。
 */
export class TlsManager {
  readonly sslDir: string;
  readonly certPath: string;
  readonly keyPath: string;

  constructor(dataDir: string) {
    this.sslDir = path.join(dataDir, 'config', 'ssl');
    this.certPath = path.join(this.sslDir, 'server.crt');
    this.keyPath = path.join(this.sslDir, 'server.key');
    mkdirSync(this.sslDir, { recursive: true });
  }

  async importFile(sourcePath: string, kind: 'cert' | 'key'): Promise<CertificateInfo> {
    const extension = path.extname(sourcePath).toLowerCase();
    const allowed =
      kind === 'cert'
        ? ['.crt', '.pem', '.cer']
        : ['.key', '.pem'];

    if (!allowed.includes(extension)) {
      throw new TlsError(
        TLS_ERROR.INVALID_FILE,
        kind === 'cert'
          ? '证书文件必须是 .crt / .pem / .cer'
          : '私钥文件必须是 .key / .pem',
      );
    }

    const target = kind === 'cert' ? this.certPath : this.keyPath;
    const temporary = `${target}.${Date.now()}.tmp`;

    await copyFile(sourcePath, temporary);
    await rename(temporary, target);
    await chmod(target, 0o600).catch(() => {});

    return this.getInfo();
  }

  getInfo(): CertificateInfo {
    const certExists = this.fileExists(this.certPath);
    const keyExists = this.fileExists(this.keyPath);
    const configured = certExists && keyExists;

    let subject: string | null = null;
    let issuer: string | null = null;
    let validFrom: string | null = null;
    let validTo: string | null = null;
    let fingerprint: string | null = null;
    let error: string | null = null;

    if (certExists) {
      try {
        const certificate = new X509Certificate(readFileSync(this.certPath));
        subject = certificate.subject.replaceAll('\n', ', ');
        issuer = certificate.issuer.replaceAll('\n', ', ');
        validFrom = new Date(certificate.validFrom).toISOString();
        validTo = new Date(certificate.validTo).toISOString();
        fingerprint = certificate.fingerprint256;
      } catch {
        error = '证书文件无法解析';
      }
    }

    if (configured && error === null) {
      try {
        createSecureContext({
          cert: readFileSync(this.certPath),
          key: readFileSync(this.keyPath),
        });
      } catch {
        error = '证书与私钥不匹配，或私钥格式不正确';
      }
    }

    return {
      configured,
      certFileName: certExists ? 'server.crt' : null,
      keyFileName: keyExists ? 'server.key' : null,
      subject,
      issuer,
      validFrom,
      validTo,
      fingerprint,
      error,
    };
  }

  validate(): void {
    const info = this.getInfo();
    if (!info.configured) {
      throw new TlsError(
        TLS_ERROR.NOT_CONFIGURED,
        '启用 HTTPS 前必须同时导入证书与私钥',
      );
    }
    if (info.error !== null) {
      throw new TlsError(TLS_ERROR.INVALID_CERTIFICATE, info.error);
    }
  }

  getOptions(): { cert: Buffer; key: Buffer } {
    this.validate();
    return {
      cert: readFileSync(this.certPath),
      key: readFileSync(this.keyPath),
    };
  }

  private fileExists(filePath: string): boolean {
    try {
      readFileSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
