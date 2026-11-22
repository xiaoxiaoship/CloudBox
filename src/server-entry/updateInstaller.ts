import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Detached updater for the headless service. The helper stops the WinSW
 * service, runs the Inno Setup package silently, then starts the service again.
 */
export function scheduleServerUpdate(options: {
  installerPath: string;
  tempDir: string;
  serviceName?: string;
}): void {
  if (process.platform !== 'win32') throw new Error('自动更新目前仅支持 Windows');
  const serviceName = options.serviceName ?? 'CloudBox';
  const script = path.join(options.tempDir, `cloudbox-server-update-${Date.now()}.cmd`);
  const body = [
    '@echo off',
    'ping -n 3 127.0.0.1 >nul',
    `sc stop "${serviceName}" >nul 2>nul`,
    'ping -n 5 127.0.0.1 >nul',
    `start "" /wait "${options.installerPath}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`,
    `sc start "${serviceName}" >nul 2>nul`,
    'del "%~f0" >nul 2>nul',
    '',
  ].join('\r\n');
  writeFileSync(script, body, 'utf8');
  const child = spawn('cmd.exe', ['/d', '/s', '/c', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}
