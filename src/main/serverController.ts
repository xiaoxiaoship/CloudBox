import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import os from 'node:os';
import type { CoreServices } from '../core/container.ts';
import { createApp } from '../server/app.ts';
import { getTrafficSnapshot, resetTraffic } from '../server/traffic.ts';
import { ProxyProtocolServer } from './proxyProtocolServer.ts';

export const SERVER_ERROR = {
  PORT_IN_USE: 'PORT_IN_USE',
  START_FAILED: 'START_FAILED',
  INVALID_PORT: 'INVALID_PORT',
  TLS_NOT_CONFIGURED: 'TLS_NOT_CONFIGURED',
} as const;

export type ServerProtocol = 'http' | 'https';

export type ServerErrorCode = (typeof SERVER_ERROR)[keyof typeof SERVER_ERROR];

export class ServerError extends Error {
  readonly code: ServerErrorCode;

  constructor(code: ServerErrorCode, message: string) {
    super(message);
    this.name = 'ServerError';
    this.code = code;
  }
}

export interface ServerStatus {
  running: boolean;
  port: number;
  bind: string;
  protocol: ServerProtocol;
  httpsEnabled: boolean;
  mtlsEnabled: boolean;
  urls: string[];
  lanIps: string[];
  startedAt: number | null;
  uploadedBytes: number;
  downloadedBytes: number;
  error: string | null;
  autoStart: boolean;
}

export function listLanIps(): string[] {
  const result: string[] = [];
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        result.push(entry.address);
      }
    }
  }

  return [...new Set(result)];
}

export function isPortAvailable(port: number, bind = '0.0.0.0'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const tester = createNetServer();

    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });

    try {
      tester.listen(port, bind);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Express 服务生命周期控制器（主进程内嵌，不走 CLI 启动路径）。
 * 默认不监听；只有管理员打开在线模式时才 start。
 */
export class ServerController {
  private readonly services: CoreServices;
  private readonly version: string;
  private readonly webDist: string;
  private readonly bind: string;

  private server: Server | null = null;
  private proxyFront: ProxyProtocolServer | null = null;
  private activePort: number | null = null;
  private activeProtocol: ServerProtocol | null = null;
  private configuredPort: number;
  private httpsEnabled: boolean;
  private mtlsEnabled: boolean;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private readonly getTlsOptions: (() => { cert: Buffer; key: Buffer }) | null;
  private readonly getMtlsCa: (() => Buffer | null) | null;
  private readonly getRootCaPath: (() => string | null) | null;
  private readonly isProxyProtocolEnabled: () => boolean;

  constructor(options: {
    services: CoreServices;
    version: string;
    webDist: string;
    port: number;
    bind?: string;
    httpsEnabled?: boolean;
    mtlsEnabled?: boolean;
    getTlsOptions?: () => { cert: Buffer; key: Buffer };
    getMtlsCa?: () => Buffer | null;
    getRootCaPath?: () => string | null;
    isProxyProtocolEnabled?: () => boolean;
  }) {
    this.services = options.services;
    this.version = options.version;
    this.webDist = options.webDist;
    this.configuredPort = options.port;
    this.bind = options.bind ?? '0.0.0.0';
    this.httpsEnabled = options.httpsEnabled ?? false;
    this.mtlsEnabled = options.mtlsEnabled ?? false;
    this.getTlsOptions = options.getTlsOptions ?? null;
    this.getMtlsCa = options.getMtlsCa ?? null;
    this.getRootCaPath = options.getRootCaPath ?? null;
    this.isProxyProtocolEnabled = options.isProxyProtocolEnabled ?? (() => false);
  }

  getStatus(): ServerStatus {
    const running = this.proxyFront !== null;
    const port = running && this.activePort !== null ? this.activePort : this.configuredPort;
    const protocol: ServerProtocol =
      this.activeProtocol ?? (this.httpsEnabled ? 'https' : 'http');
    const lanIps = listLanIps();
    const urls = lanIps.map((ip) => `${protocol}://${ip}:${port}`);
    const traffic = getTrafficSnapshot();

    return {
      running,
      port,
      bind: this.bind,
      protocol,
      httpsEnabled: this.httpsEnabled,
      mtlsEnabled: this.mtlsEnabled,
      urls,
      lanIps,
      startedAt: this.startedAt,
      uploadedBytes: traffic.uploadedBytes,
      downloadedBytes: traffic.downloadedBytes,
      error: this.lastError,
      autoStart: this.services.settings.get('server.autoStart'),
    };
  }

  setConfiguredPort(port: number): void {
    this.configuredPort = port;
  }

  configureHttps(enabled: boolean): void {
    this.httpsEnabled = enabled;
  }

  configureMtls(enabled: boolean): void {
    this.mtlsEnabled = enabled;
  }

  async start(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {      throw new ServerError(SERVER_ERROR.INVALID_PORT, '端口必须在 1024-65535 之间');
    }

    if (this.server !== null) {
      await this.stop();
    }
    resetTraffic();

    const protocol: ServerProtocol = this.httpsEnabled ? 'https' : 'http';

    const app = createApp({
      services: this.services,
      version: this.version,
      webDist: this.webDist,
      getPublicRootCa: () => ({
        enabled: this.httpsEnabled,
        certPath: this.getRootCaPath?.() ?? null,
      }),
    });

    let instance: Server;
    try {
      if (protocol === 'https') {
        if (this.getTlsOptions === null) {
          throw new ServerError(SERVER_ERROR.TLS_NOT_CONFIGURED, '未配置证书与私钥');
        }
        const tlsOptions = this.getTlsOptions();
        const serverOptions: Parameters<typeof createHttpsServer>[0] = {
          ...tlsOptions,
          minVersion: 'TLSv1.2',
        };

        if (this.mtlsEnabled) {
          const ca = this.getMtlsCa?.() ?? null;
          if (ca === null) {
            throw new ServerError(
              SERVER_ERROR.TLS_NOT_CONFIGURED,
              '启用双向认证前需要先生成或导入私有 CA',
            );
          }
          serverOptions.ca = ca;
          serverOptions.requestCert = true;
          serverOptions.rejectUnauthorized = true;
        }

        instance = createHttpsServer(serverOptions, app);
      } else {
        instance = createHttpServer(app);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      throw new ServerError(
        protocol === 'https' ? SERVER_ERROR.TLS_NOT_CONFIGURED : SERVER_ERROR.START_FAILED,
        message,
      );
    }

    try {
      const server = await new Promise<Server>((resolve, reject) => {
        instance.once('listening', () => resolve(instance));
        instance.once('error', (error: NodeJS.ErrnoException) => {
          instance.close();
          if (error.code === 'EADDRINUSE') {
            reject(
              new ServerError(
                SERVER_ERROR.PORT_IN_USE,
                `内部端口已被占用，请重试`,
              ),
            );
          } else {
            reject(new ServerError(SERVER_ERROR.START_FAILED, error.message));
          }
        });

        // Express listens only on loopback; the public front door owns the
        // configured port and forwards both LAN and frpc sockets.
        instance.listen(0, '127.0.0.1');
      });

      const proxyFront = new ProxyProtocolServer({
        expressServer: instance,
        port,
        bind: this.bind,
        enabled: this.isProxyProtocolEnabled,
      });
      try {
        await proxyFront.start();
      } catch (error) {
        instance.close();
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
          throw new ServerError(
            SERVER_ERROR.PORT_IN_USE,
            `端口 ${port} 已被占用，请换一个端口或先关闭占用程序`,
          );
        }
        throw new ServerError(
          SERVER_ERROR.START_FAILED,
          error instanceof Error ? error.message : String(error),
        );
      }

      server.on('error', (error) => {
        this.lastError = error.message;
      });

      this.server = server;
      this.proxyFront = proxyFront;
      this.activePort = port;
      this.activeProtocol = protocol;
      this.configuredPort = port;
      this.startedAt = Date.now();
      this.lastError = null;
    } catch (error) {
      await this.proxyFront?.stop().catch(() => {});
      this.proxyFront = null;
      this.server = null;
      this.activePort = null;
      this.activeProtocol = null;
      this.startedAt = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const front = this.proxyFront;
    this.server = null;
    this.proxyFront = null;
    this.activePort = null;
    this.activeProtocol = null;
    this.startedAt = null;

    if (front !== null) await front.stop();
    if (server === null) return;

    server.closeAllConnections?.();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // 极端情况下 close 回调可能不触发，兜底
      setTimeout(resolve, 2_000).unref?.();
    });
  }
}
