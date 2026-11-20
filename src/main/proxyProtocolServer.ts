import { connect, createServer, type Server as NetServer, type Socket } from 'node:net';
import type { Server as HttpServer } from 'node:http';

const SIGNATURE = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);

export interface ProxySocket extends Socket {
  realIp?: string;
}

function normalizeIp(value: string | undefined): string {
  if (!value) return '127.0.0.1';
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function isLoopback(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '0:0:0:0:0:0:0:1';
}

interface ProxyOptions {
  expressServer: HttpServer;
  port: number;
  bind?: string;
  enabled: () => boolean;
  proxyTimeoutMs?: number;
}

/**
 * A plain-TCP front door. LAN clients are handed directly to Express; only
 * loopback connections (frpc) are allowed to speak PROXY protocol v2.
 */
export class ProxyProtocolServer {
  private readonly options: ProxyOptions;
  private server: NetServer | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly pendingIps = new Map<number, string>();

  constructor(options: ProxyOptions) {
    this.options = options;
    options.expressServer.prependListener('connection', (internal) => {
      const port = internal.remotePort ?? -1;
      let attempts = 0;
      const applyIp = (): void => {
        const ip = this.pendingIps.get(port);
        if (ip) {
          (internal as ProxySocket).realIp = ip;
          this.pendingIps.delete(port);
          return;
        }
        if (attempts++ < 100 && !internal.destroyed) setTimeout(applyIp, 5).unref?.();
      };
      applyIp();
    });
  }

  get port(): number {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : this.options.port;
  }

  async start(): Promise<void> {
    if (this.server !== null) return;
    const server = createServer((socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      this.handle(socket);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.bind ?? '0.0.0.0', () => resolve());
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 1_000).unref?.();
    });
  }

  private handle(socket: ProxySocket): void {
    const remote = normalizeIp(socket.remoteAddress);
    if (!this.options.enabled() || !isLoopback(remote)) {
      this.forward(socket, remote);
      return;
    }

    let buffer = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.off('data', onData);
      socket.unshift(buffer);
      this.forwardViaInternal(socket, remote);
    }, this.options.proxyTimeoutMs ?? 3_000);
    timeout.unref?.();

    const finish = (realIp: string, rest: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.setTimeout(0);
      if (rest.length > 0) socket.unshift(rest);
      this.forwardViaInternal(socket, realIp);
    };

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 16) return;

      if (!buffer.subarray(0, 12).equals(SIGNATURE)) {
        finish(remote, buffer);
        return;
      }

      const versionCommand = buffer[12] ?? 0;
      if ((versionCommand >> 4) !== 2) {
        finish(remote, buffer);
        return;
      }
      const family = buffer[13] ?? 0;
      const length = buffer.readUInt16BE(14);
      if (length > 65_535) {
        finish(remote, buffer);
        return;
      }
      if (buffer.length < 16 + length) return;

      const command = versionCommand & 0x0f;
      let realIp = remote;
      if (command === 1) {
        if (family === 0x11 && length >= 12) {
          realIp = `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`;
        } else if (family === 0x21 && length >= 36) {
          const bytes = buffer.subarray(20, 36);
          const groups: string[] = [];
          for (let index = 0; index < 16; index += 2) {
            groups.push(bytes.readUInt16BE(index).toString(16));
          }
          realIp = groups.join(':');
        }
      }
      finish(realIp, buffer.subarray(16 + length));
    };

    socket.on('data', onData);
    socket.once('error', () => {
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
    });
  }

  private forward(socket: ProxySocket, realIp: string): void {
    socket.pause();
    socket.realIp = normalizeIp(realIp);
    this.options.expressServer.emit('connection', socket);
  }

  private forwardViaInternal(socket: ProxySocket, realIp: string): void {
    const address = this.options.expressServer.address();
    if (!address || typeof address !== 'object') {
      socket.destroy();
      return;
    }
    socket.pause();
    const internal = connect(address.port, '127.0.0.1') as ProxySocket;
    internal.once('connect', () => {
      this.pendingIps.set(internal.localPort ?? -1, normalizeIp(realIp));
      setTimeout(() => {
        socket.pipe(internal);
        internal.pipe(socket);
      }, 10);
    });
    internal.once('error', () => socket.destroy());
    socket.once('error', () => internal.destroy());
    socket.once('close', () => internal.destroy());
    internal.once('close', () => socket.destroy());
  }
}
