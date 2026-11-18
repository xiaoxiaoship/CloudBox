import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import * as mkcert from '@mkcert/node';
import forge from 'node-forge';
import type { SettingsService } from '../core/services/settingsService.ts';
import type { CaInfo, CertificateInfo, ClientCertExport } from '../shared/ipcTypes.ts';
import { listLanIps } from './serverController.ts';
import type { TlsManager } from './tlsManager.ts';

export const CA_ERROR = {
  ALREADY_EXISTS: 'CA_ALREADY_EXISTS',
  MISSING: 'CA_MISSING',
  GENERATE_FAILED: 'CA_GENERATE_FAILED',
  INVALID_HOSTS: 'CA_INVALID_HOSTS',
  INSTALL_FAILED: 'CA_INSTALL_FAILED',
  EXPORT_FAILED: 'CA_EXPORT_FAILED',
} as const;

export type CaErrorCode = (typeof CA_ERROR)[keyof typeof CA_ERROR];
const CLIENT_P12_PASSWORD = 'changeit';

export class CaError extends Error {
  readonly code: CaErrorCode;

  constructor(code: CaErrorCode, message: string) {
    super(message);
    this.name = 'CaError';
    this.code = code;
  }
}

interface GenerateOptions {
  hosts: string[];
  certFile: string;
  keyFile: string;
  p12File?: string;
  client?: boolean;
  pkcs12?: boolean;
}

/**
 * 私有 CA：
 *  - CA 文件放在 data/config/ssl/ca/（rootCA.pem + rootCA-key.pem）
 *  - 服务端证书放在 data/config/ssl/server/，并复制到 TlsManager 的活动路径
 *  - 客户端证书使用 mkcert -client -pkcs12，导出时由用户选择保存位置
 *
 * @mkcert/node 实际只暴露 generate/install/uninstall；这里通过 caroot 隔离出独立 CA。
 * 打包后 Node 包内的二进制位于 asar 中无法执行，因此使用随包放置的 resources/bin/mkcert.exe 回退。
 */
export class CaManager {
  readonly caDir: string;
  readonly serverDir: string;
  readonly caCertPath: string;
  readonly caKeyPath: string;

  private readonly tls: TlsManager;
  private readonly settings: SettingsService;

  constructor(options: { dataDir: string; tls: TlsManager; settings: SettingsService }) {
    this.caDir = path.join(options.dataDir, 'config', 'ssl', 'ca');
    this.serverDir = path.join(options.dataDir, 'config', 'ssl', 'server');
    this.caCertPath = path.join(this.caDir, 'rootCA.pem');
    this.caKeyPath = path.join(this.caDir, 'rootCA-key.pem');
    this.tls = options.tls;
    this.settings = options.settings;
  }

  getCAInfo(): CaInfo {
    const certExists = existsSync(this.caCertPath);
    const keyExists = existsSync(this.caKeyPath);

    let subject: string | null = null;
    let issuer: string | null = null;
    let validFrom: string | null = null;
    let validTo: string | null = null;
    let fingerprint: string | null = null;
    let error: string | null = null;

    if (certExists) {
      try {
        const certificate = new X509Certificate(readFileSync(this.caCertPath));
        subject = certificate.subject.replaceAll('\n', ', ');
        issuer = certificate.issuer.replaceAll('\n', ', ');
        validFrom = new Date(certificate.validFrom).toISOString();
        validTo = new Date(certificate.validTo).toISOString();
        fingerprint = certificate.fingerprint256;
      } catch {
        error = 'CA 证书无法解析';
      }
    }

    return {
      exists: certExists && keyExists,
      caDir: this.caDir,
      certFileName: certExists ? 'rootCA.pem' : null,
      keyFileName: keyExists ? 'rootCA-key.pem' : null,
      subject,
      issuer,
      validFrom,
      validTo,
      fingerprint,
      installed: this.settings.get('ca.installed'),
      error,
    };
  }

  async createPrivateCA(): Promise<CaInfo> {
    if (existsSync(this.caCertPath) || existsSync(this.caKeyPath)) {
      throw new CaError(CA_ERROR.ALREADY_EXISTS, '私有 CA 已存在，为避免覆盖已停止生成');
    }

    await mkdir(this.caDir, { recursive: true, mode: 0o700 });
    const bootstrapDir = await mkdtemp(path.join(os.tmpdir(), 'cloudbox-ca-'));

    try {
      // mkcert 在首次签发时会创建 rootCA；先生成一张临时证书，再安装 CA。
      await this.generate(
        {
          hosts: ['localhost'],
          certFile: path.join(bootstrapDir, 'bootstrap.crt'),
          keyFile: path.join(bootstrapDir, 'bootstrap.key'),
        },
        this.caDir,
      );
    } catch (error) {
      throw new CaError(
        CA_ERROR.GENERATE_FAILED,
        `生成私有 CA 失败：${messageOf(error)}`,
      );
    } finally {
      await rm(bootstrapDir, { recursive: true, force: true }).catch(() => {});
    }

    await this.secureCAFiles();

    try {
      await this.installCA();
    } catch (error) {
      throw new CaError(
        CA_ERROR.INSTALL_FAILED,
        `CA 已生成，但安装到系统信任库失败：${messageOf(error)}。请以管理员身份重试“安装 CA”。`,
      );
    }

    return this.getCAInfo();
  }

  async issueServerCert(extraHosts = ''): Promise<CertificateInfo> {
    this.assertCAExists();
    await mkdir(this.serverDir, { recursive: true, mode: 0o700 });

    const hosts = [
      'localhost',
      '127.0.0.1',
      '::1',
      os.hostname(),
      ...listLanIps(),
      ...parseExtraHosts(extraHosts),
    ].filter((host, index, all) => host.length > 0 && all.indexOf(host) === index);

    const serverCertPath = path.join(this.serverDir, 'server.crt');
    const serverKeyPath = path.join(this.serverDir, 'server.key');

    try {
      await this.generate(
        {
          hosts,
          certFile: serverCertPath,
          keyFile: serverKeyPath,
        },
        this.caDir,
      );
    } catch (error) {
      throw new CaError(
        CA_ERROR.GENERATE_FAILED,
        `签发服务端证书失败：${messageOf(error)}`,
      );
    }

    await chmod(serverCertPath, 0o600).catch(() => {});
    await chmod(serverKeyPath, 0o600).catch(() => {});

    // 复制到现有 TlsManager 的活动路径，手动导入逻辑保持不变
    await copyFile(serverCertPath, this.tls.certPath);
    await copyFile(serverKeyPath, this.tls.keyPath);
    await chmod(this.tls.certPath, 0o600).catch(() => {});
    await chmod(this.tls.keyPath, 0o600).catch(() => {});

    return this.tls.getInfo();
  }

  async issueClientCert(destinationPath: string): Promise<ClientCertExport> {
    this.assertCAExists();
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'cloudbox-client-'));
    const certPath = path.join(temporary, 'client.crt');
    const keyPath = path.join(temporary, 'client.key');

    try {
      await this.generate(
        {
          hosts: ['cloudbox-client'],
          certFile: certPath,
          keyFile: keyPath,
          client: true,
        },
        this.caDir,
      );
      await chmod(certPath, 0o600).catch(() => {});
      await chmod(keyPath, 0o600).catch(() => {});

      const extension = path.extname(destinationPath).toLowerCase();
      if (extension === '.pem') {
        const [cert, key, ca] = await Promise.all([
          readFile(certPath, 'utf8'),
          readFile(keyPath, 'utf8'),
          readFile(this.caCertPath, 'utf8'),
        ]);
        await writeFile(
          destinationPath,
          `# CloudBox client certificate\n${cert}\n${key}\n# CloudBox private CA\n${ca}\n`,
          { mode: 0o600 },
        );
      } else {
        // mkcert 自带的 PKCS#12 使用旧式 RC2/3DES，Node 与部分新系统无法读取；
        // 这里用 node-forge 重新打包为 AES-256 PKCS#12，密码固定 changeit。
        const [cert, key, ca] = await Promise.all([
          readFile(certPath, 'utf8'),
          readFile(keyPath, 'utf8'),
          readFile(this.caCertPath, 'utf8'),
        ]);
        const p12 = forge.pkcs12.toPkcs12Asn1(
          forge.pki.privateKeyFromPem(key),
          [forge.pki.certificateFromPem(cert), forge.pki.certificateFromPem(ca)],
          CLIENT_P12_PASSWORD,
          { algorithm: 'aes256' },
        );
        const der = forge.asn1.toDer(p12).getBytes();
        await writeFile(destinationPath, Buffer.from(der, 'binary'), { mode: 0o600 });
      }

      return {
        saved: true,
        fileName: path.basename(destinationPath),
        password: extension === '.pem' ? undefined : CLIENT_P12_PASSWORD,
      };
    } catch (error) {
      throw new CaError(
        CA_ERROR.EXPORT_FAILED,
        `导出客户端证书失败：${messageOf(error)}`,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }

  async installCA(): Promise<CaInfo> {
    this.assertCAExists();
    try {
      await this.runInstall();
    } catch (error) {
      this.settings.set('ca.installed', false, null);
      throw new CaError(
        CA_ERROR.INSTALL_FAILED,
        `安装 CA 到系统信任库失败：${messageOf(error)}`,
      );
    }

    this.settings.set('ca.installed', true, null);
    await this.secureCAFiles();
    return this.getCAInfo();
  }

  async uninstallCA(): Promise<CaInfo> {
    this.assertCAExists();
    try {
      await this.runUninstall();
    } catch (error) {
      throw new CaError(
        CA_ERROR.INSTALL_FAILED,
        `卸载 CA 失败：${messageOf(error)}`,
      );
    }

    this.settings.set('ca.installed', false, null);
    return this.getCAInfo();
  }

  getCACertBuffer(): Buffer | null {
    if (!existsSync(this.caCertPath)) return null;
    return readFileSync(this.caCertPath);
  }

  private assertCAExists(): void {
    if (!existsSync(this.caCertPath) || !existsSync(this.caKeyPath)) {
      throw new CaError(CA_ERROR.MISSING, '私有 CA 尚未生成');
    }
  }

  private async secureCAFiles(): Promise<void> {
    await chmod(this.caDir, 0o700).catch(() => {});
    await chmod(this.caCertPath, 0o600).catch(() => {});
    await chmod(this.caKeyPath, 0o600).catch(() => {});
  }

  private async generate(options: GenerateOptions, caroot: string): Promise<void> {
    if (!app.isPackaged) {
      await mkcert.generate({
        hosts: options.hosts,
        certFile: options.certFile,
        keyFile: options.keyFile,
        p12File: options.p12File,
        client: options.client,
        pkcs12: options.pkcs12,
        caroot,
        install: false,
      });
      return;
    }

    const args: string[] = [];
    if (options.certFile) args.push('-cert-file', options.certFile);
    if (options.keyFile) args.push('-key-file', options.keyFile);
    if (options.p12File) args.push('-p12-file', options.p12File);
    if (options.client) args.push('-client');
    if (options.pkcs12) args.push('-pkcs12');
    args.push(...options.hosts);

    await this.runBinary(args, caroot);
  }

  private async runInstall(): Promise<void> {
    if (!app.isPackaged) {
      await this.withCaroot(async () => mkcert.install());
      return;
    }
    await this.runBinary(['-install'], this.caDir);
  }

  private async runUninstall(): Promise<void> {
    if (!app.isPackaged) {
      await this.withCaroot(async () => mkcert.uninstall());
      return;
    }
    await this.runBinary(['-uninstall'], this.caDir);
  }

  private async withCaroot(action: () => Promise<void>): Promise<void> {
    const previous = process.env.CAROOT;
    process.env.CAROOT = this.caDir;
    try {
      await action();
    } finally {
      if (previous === undefined) {
        delete process.env.CAROOT;
      } else {
        process.env.CAROOT = previous;
      }
    }
  }

  private async runBinary(args: string[], caroot: string): Promise<void> {
    const binary = resolveMkcertBinary();
    if (binary === null) {
      throw new Error(
        '未找到 mkcert 可执行文件。请将 mkcert.exe 放入 resources/bin/ 后重新打包。',
      );
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, args, {
        windowsHide: true,
        env: { ...process.env, CAROOT: caroot },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf8');
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error((stderr || stdout || `mkcert 退出码 ${code ?? 'null'}`).trim()));
        }
      });
    });
  }
}

function parseExtraHosts(raw: string): string[] {
  if (!raw.trim()) return [];
  const entries = raw
    .split(/[,\n]/)
    .map((entry) => entry.trim().replace(/^\[|\]$/g, ''))
    .filter((entry) => entry.length > 0);
  if (entries.length > 20) {
    throw new CaError(CA_ERROR.INVALID_HOSTS, '最多填写 20 个域名或 IP');
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const host = entry.toLowerCase();
    if (
      host.includes('://') ||
      host.includes('/') ||
      host.includes('\\') ||
      host.includes(' ') ||
      host.length > 253
    ) {
      throw new CaError(CA_ERROR.INVALID_HOSTS, `无效的域名或 IP：${entry}`);
    }
    const isWildcard = host.startsWith('*.');
    const candidate = isWildcard ? host.slice(2) : host;
    const validHostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(candidate);
    if (isIP(host) === 0 && !validHostname) {
      throw new CaError(CA_ERROR.INVALID_HOSTS, `无效的域名或 IP：${entry}`);
    }
    if (!seen.has(host)) {
      seen.add(host);
      result.push(host);
    }
  }
  return result;
}

function resolveMkcertBinary(): string | null {  const candidates = [
    path.join(process.resourcesPath, 'bin', 'mkcert.exe'),
    path.join(app.getAppPath(), 'resources', 'bin', 'mkcert.exe'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
