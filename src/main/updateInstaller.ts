import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Launch a detached helper that waits for the current app to exit, runs the
 * NSIS installer silently, then starts the new executable. The helper must be
 * detached so the current process can quit immediately after scheduling it.
 */
export function scheduleGuiUpdate(options: {
  installerPath: string;
  executablePath: string;
  tempDir: string;
}): void {
  if (process.platform !== 'win32') {
    throw new Error('自动更新目前仅支持 Windows');
  }
  const script = path.join(options.tempDir, `cloudbox-update-${Date.now()}.cmd`);
  const body = [
    '@echo off',
    'ping -n 3 127.0.0.1 >nul',
    `start "" /wait "${options.installerPath}" /S`,
    `start "" "${options.executablePath}"`,
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
