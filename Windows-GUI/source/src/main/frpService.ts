import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { FrpConfig, FrpStatus } from '../shared/ipcTypes.ts';

export const FRP_ERROR = {
  MISSING_BINARY: 'FRP_MISSING_BINARY',
  INVALID_CONFIG: 'FRP_INVALID_CONFIG',
  START_FAILED: 'FRP_START_FAILED',
} as const;

export type FrpErrorCode = (typeof FRP_ERROR)[keyof typeof FRP_ERROR];

export class FrpError extends Error {
  readonly code: FrpErrorCode;

  constructor(code: FrpErrorCode, message: string) {
    super(message);
    this.name = 'FrpError';
    this.code = code;
  }
}

const MAX_LOG_LINES = 300;

export function resolveFrpcBinary(): string | null {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'bin', 'frpc.exe'),
        path.join(app.getAppPath(), 'resources', 'bin', 'frpc.exe'),
      ]
    : [
        path.join(app.getAppPath(), 'resources', 'bin', 'frpc.exe'),
        path.join(process.cwd(), 'resources', 'bin', 'frpc.exe'),
      ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * frpc 子进程托管：
 *  - 配置写入 data/config/frpc.toml
 *  - stdout/stderr 进入环形缓冲，供管理端轮询展示
 *  - 停止后再启动实现热重载
 */
export class FrpService {
  private readonly configPath: string;
  private readonly getLocalPort: () => number;
  private readonly getProtocol: () => 'http' | 'https';
  private readonly binaryPath: string | null;

  private config: FrpConfig;
  private child: ChildProcess | null = null;
  private logs: string[] = [];
  private error: string | null = null;
  private stopping = false;

  constructor(options: {
    dataDir: string;
    config: FrpConfig;
    getLocalPort: () => number;
    getProtocol: () => 'http' | 'https';
    binaryPath?: string | null;
  }) {
    const configDir = path.join(options.dataDir, 'config');
    mkdirSync(configDir, { recursive: true });
    this.configPath = path.join(configDir, 'frpc.toml');
    this.config = options.config;
    this.getLocalPort = options.getLocalPort;
    this.getProtocol = options.getProtocol;
    this.binaryPath =
      options.binaryPath === undefined ? resolveFrpcBinary() : options.binaryPath;
  }

  getStatus(): FrpStatus {
    return {
      available: this.binaryPath !== null,
      binaryPath: this.binaryPath,
      running: this.child !== null,
      pid: this.child?.pid ?? null,
      config: { ...this.config },
      configPath: this.configPath,
      logs: [...this.logs],
      error: this.error,
    };
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  async setConfig(config: FrpConfig): Promise<FrpStatus> {
    this.validateConfig(config);
    this.config = { ...config };
    this.writeConfigFile();

    if (this.child !== null) {
      await this.restart();
    }

    return this.getStatus();
  }

  async start(): Promise<FrpStatus> {
    if (this.child !== null) return this.getStatus();
    if (this.binaryPath === null) {
      throw new FrpError(
        FRP_ERROR.MISSING_BINARY,
        '未找到 frpc.exe。请将 frpc.exe 放入 resources/bin/ 后重启，或重新打包。',
      );
    }

    this.validateConfig(this.config);
    this.writeConfigFile();
    this.error = null;
    this.appendLog(`[cloudbox] 启动 frpc：${this.binaryPath}`);

    const child = spawn(this.binaryPath, ['-c', this.configPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = child;

    child.stdout?.on('data', (data: Buffer) => this.appendLog(data.toString('utf8')));
    child.stderr?.on('data', (data: Buffer) => this.appendLog(data.toString('utf8')));

    child.on('error', (error) => {
      this.error = error.message;
      this.appendLog(`[cloudbox] frpc 启动失败：${error.message}`);
      this.child = null;
    });

    child.on('exit', (code, signal) => {
      const expected = this.stopping;
      this.child = null;
      this.stopping = false;
      this.appendLog(
        `[cloudbox] frpc 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`,
      );
      if (!expected && code !== 0) {
        this.error = `frpc 异常退出（code=${code ?? 'unknown'}）`;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    if (this.child === null) {
      throw new FrpError(
        FRP_ERROR.START_FAILED,
        this.error ?? 'frpc 未能保持运行，请查看日志与 frpc.toml 配置',
      );
    }

    return this.getStatus();
  }

  async stop(): Promise<FrpStatus> {
    const child = this.child;
    if (child === null) return this.getStatus();

    this.stopping = true;
    this.appendLog('[cloudbox] 正在停止 frpc…');
    child.kill();

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      child.once('exit', finish);
      setTimeout(() => {
        if (this.child !== null && child.pid !== undefined) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('exit', () => finish());
        }
        finish();
      }, 3_000).unref?.();
    });

    this.child = null;
    this.stopping = false;
    return this.getStatus();
  }

  async restart(): Promise<FrpStatus> {
    await this.stop();
    return this.start();
  }

  async restartIfRunning(): Promise<void> {
    if (this.child === null) return;
    await this.restart();
  }

  private validateConfig(config: FrpConfig): void {
    if (!config.serverAddr.trim()) {
      throw new FrpError(FRP_ERROR.INVALID_CONFIG, '请填写 frps 服务器地址');
    }
    if (!Number.isInteger(config.serverPort) || config.serverPort < 1 || config.serverPort > 65_535) {
      throw new FrpError(FRP_ERROR.INVALID_CONFIG, 'frps 服务端口必须在 1-65535 之间');
    }
    if (config.tunnelType === 'tcp') {
      if (!Number.isInteger(config.remotePort) || config.remotePort < 1 || config.remotePort > 65_535) {
        throw new FrpError(FRP_ERROR.INVALID_CONFIG, 'TCP 隧道远程映射端口必须在 1-65535 之间');
      }
    } else {
      const domain = config.customDomain.trim();
      if (!/^[A-Za-z0-9.*-]+(?:\.[A-Za-z0-9.*-]+)+$/.test(domain)) {
        throw new FrpError(FRP_ERROR.INVALID_CONFIG, 'HTTP/HTTPS 隧道需要填写完整域名');
      }
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.proxyName)) {
      throw new FrpError(FRP_ERROR.INVALID_CONFIG, '代理名称只能包含字母、数字、下划线和短横线');
    }
  }

  private writeConfigFile(): void {
    const localPort = this.getLocalPort();
    const protocol = this.getProtocol();
    const lines = [
      '# 由 CloudBox 管理端自动生成，请勿手工修改',
      `serverAddr = ${JSON.stringify(this.config.serverAddr.trim())}`,
      `serverPort = ${this.config.serverPort}`,
      'loginFailExit = false',
      '',
    ];

    if (this.config.token.trim()) {
      lines.push('auth.method = "token"');
      lines.push(`auth.token = ${JSON.stringify(this.config.token.trim())}`);
      lines.push('');
    }
    if (this.config.user.trim()) {
      lines.push(`user = ${JSON.stringify(this.config.user.trim())}`);
      lines.push('');
    }

    lines.push('[transport]');
    lines.push('protocol = "tcp"');
    lines.push('');
    lines.push('[transport.tls]');
    lines.push('enable = true');
    lines.push('');

    lines.push('[[proxies]]');
    lines.push(`name = ${JSON.stringify(this.config.proxyName)}`);
    lines.push(`type = ${JSON.stringify(this.config.tunnelType)}`);
    lines.push('localIP = "127.0.0.1"');
    lines.push(`localPort = ${localPort}`);

    if (this.config.tunnelType === 'tcp') {
      lines.push(`remotePort = ${this.config.remotePort}`);
      if (this.config.proxyProtocol) {
        // 仅当本地服务支持 PROXY protocol v2 时启用；Express 默认不解析该协议。
        lines.push('transport.proxyProtocolVersion = "v2"');
      }
    } else {
      lines.push(`customDomains = [${JSON.stringify(this.config.customDomain.trim())}]`);
      // 主界面与静态托管共享同一 HTTP 隧道端口，不额外映射 TCP 端口
      lines.push('locations = ["/", "/host"]');
    }

    lines.push('');
    lines.push(`# 本地协议：${protocol}`);

    const temporary = `${this.configPath}.tmp`;
    writeFileSync(temporary, `${lines.join('\n')}\n`, 'utf8');
    renameSync(temporary, this.configPath);
  }

  private appendLog(chunk: string): void {
    const lines = chunk
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      this.logs.push(line);
    }

    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    }
  }
}
