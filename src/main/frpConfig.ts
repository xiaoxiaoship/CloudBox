import type { FrpConfig } from '../shared/ipcTypes.ts';

/** Generate the frpc TOML for both the CLI and the desktop service. */
export function buildFrpConfig(
  config: FrpConfig,
  localPort: number,
  protocol: 'http' | 'https',
): string {
  const lines = [
    '# 由 CloudBox 管理端自动生成，请勿手工修改',
    `serverAddr = ${JSON.stringify(config.serverAddr.trim())}`,
    `serverPort = ${config.serverPort}`,
    'loginFailExit = false',
    '',
  ];

  if (config.token.trim()) {
    lines.push('auth.method = "token"');
    lines.push(`auth.token = ${JSON.stringify(config.token.trim())}`);
    lines.push('');
  }
  if (config.user.trim()) {
    lines.push(`user = ${JSON.stringify(config.user.trim())}`);
    lines.push('');
  }

  lines.push('[transport]');
  lines.push('protocol = "tcp"');
  if (config.healthCheckMux) {
    lines.push('tcpMux = true');
  }
  lines.push('');
  lines.push('[transport.tls]');
  lines.push('enable = true');
  lines.push('');

  lines.push('[[proxies]]');
  lines.push(`name = ${JSON.stringify(config.proxyName)}`);
  lines.push(`type = ${JSON.stringify(config.tunnelType)}`);
  lines.push('localIP = "127.0.0.1"');
  lines.push(`localPort = ${localPort}`);

  if (config.tunnelType === 'tcp') {
    lines.push(`remotePort = ${config.remotePort}`);
    if (config.proxyProtocol) {
      lines.push('transport.proxyProtocolVersion = "v2"');
    }
    if (config.healthCheckMux) {
      lines.push('healthCheck.type = "tcp"');
      lines.push('healthCheck.timeoutSeconds = 3');
      lines.push('healthCheck.maxFailed = 3');
      lines.push('healthCheck.intervalSeconds = 10');
    }
  } else {
    lines.push(`customDomains = [${JSON.stringify(config.customDomain.trim())}]`);
    lines.push('locations = ["/", "/host"]');
    if (config.tunnelType === 'https' && config.proxyProtocol) {
      lines.push('transport.proxyProtocolVersion = "v2"');
    }
  }

  lines.push('');
  lines.push(`# 本地协议：${protocol}`);
  return `${lines.join('\n')}\n`;
}
