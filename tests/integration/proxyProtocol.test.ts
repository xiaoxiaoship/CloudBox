import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ProxyProtocolServer } from '../../src/main/proxyProtocolServer.ts';
import { buildFrpConfig } from '../../src/main/frpConfig.ts';
import type { FrpConfig } from '../../src/shared/ipcTypes.ts';

function proxyHeader(ip: string): Buffer {
  const signature = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);
  const header = Buffer.alloc(28);
  signature.copy(header, 0);
  header[12] = 0x21; // v2, PROXY
  header[13] = 0x11; // IPv4, STREAM
  header.writeUInt16BE(12, 14);
  for (const [index, octet] of ip.split('.').entries()) header[16 + index] = Number(octet);
  header[20] = 127;
  header[21] = 0;
  header[22] = 0;
  header[23] = 1;
  header.writeUInt16BE(12345, 24);
  header.writeUInt16BE(443, 26);
  return header;
}

function request(port: number, data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    socket.on('connect', () => socket.write(data));
    socket.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
    socket.setTimeout(5_000, () => reject(new Error('proxy test timeout')));
  });
}

describe('PROXY protocol front server', () => {

  it('从本机 PROXY v2 流中提取真实 IP，并把剩余 HTTP 请求交给 Express', async () => {
    const internal = createHttpServer((req, res) => {
      res.end(`${(req.socket as unknown as { realIp?: string }).realIp}|${req.socket.remoteAddress}`);
    });
    await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
    const front = new ProxyProtocolServer({
      expressServer: internal,
      port: 0,
      bind: '127.0.0.1',
      enabled: () => true,
    });
    await front.start();
    try {
      const response = await request(
        front.port,
        Buffer.concat([
          proxyHeader('203.0.113.5'),
          Buffer.from('GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n'),
        ]),
      );
      assert.match(response, /203\.0\.113\.5\|/);
    } finally {
      await front.stop();
      await new Promise<void>((resolve) => internal.close(() => resolve()));
    }
  });

  it('无 PROXY 头的本机请求原样放行', async () => {
    const internal = createHttpServer((_req, res) => res.end('DIRECT'));
    await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
    const front = new ProxyProtocolServer({
      expressServer: internal,
      port: 0,
      bind: '127.0.0.1',
      enabled: () => true,
    });
    await front.start();
    try {
      const response = await request(front.port, Buffer.from('GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n'));
      assert.match(response, /DIRECT/);
    } finally {
      await front.stop();
      await new Promise<void>((resolve) => internal.close(() => resolve()));
    }
  });

  it('frpc 配置按 TCP + proxyProtocol 增删 PROXY 行', () => {
    const config: FrpConfig = {
      serverAddr: 'frp.example.com',
      serverPort: 7000,
      remotePort: 12345,
      token: '',
      user: '',
      proxyName: 'cloudbox',
      tunnelType: 'tcp',
      customDomain: '',
      proxyProtocol: true,
      healthCheckMux: false,
    };
    assert.match(buildFrpConfig(config, 8888, 'http'), /transport\.proxyProtocolVersion = "v2"/);
    assert.doesNotMatch(buildFrpConfig({ ...config, proxyProtocol: false }, 8888, 'http'), /transport\.proxyProtocolVersion/);
    assert.doesNotMatch(buildFrpConfig({ ...config, tunnelType: 'http', customDomain: 'pan.example.com' }, 8888, 'http'), /transport\.proxyProtocolVersion/);
    const health = buildFrpConfig({ ...config, healthCheckMux: true }, 8888, 'http');
    assert.match(health, /tcpMux = true/);
    assert.match(health, /healthCheck\.type = "tcp"/);
    assert.doesNotMatch(buildFrpConfig({ ...config, healthCheckMux: false }, 8888, 'http'), /transport\.healthCheck/);
  });
});
