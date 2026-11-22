import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const stage = process.env.CLOUDBOX_SERVER_STAGE
  ? path.resolve(process.env.CLOUDBOX_SERVER_STAGE)
  : path.join(os.tmpdir(), 'CloudBoxStage');
const required = ['dist/headless/index.mjs', 'dist/admin/index.html', 'dist/web/index.html', 'package.json'];
for (const item of required) {
  if (!existsSync(path.join(root, item))) throw new Error(`missing build artifact: ${item}`);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const item of ['dist', 'resources', 'node_modules']) {
  cpSync(path.join(root, item), path.join(stage, item), { recursive: true });
}
for (const item of ['package.json', 'package-lock.json']) {
  copyFileSync(path.join(root, item), path.join(stage, item));
}
copyFileSync(process.execPath, path.join(stage, 'node.exe'));
for (const item of ['CloudBoxService.xml', 'CloudBoxService.exe']) {
  copyFileSync(path.join(root, 'installer', 'winsw', item), path.join(stage, item));
}

if (process.platform === 'win32') {
  execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm prune --omit=dev --ignore-scripts'], {
    stdio: 'inherit',
    cwd: stage,
  });
} else {
  execFileSync('npm', ['prune', '--omit=dev', '--ignore-scripts'], {
    stdio: 'inherit',
    cwd: stage,
  });
}
console.log(`server staging directory: ${stage}`);
