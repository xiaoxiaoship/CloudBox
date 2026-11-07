#!/usr/bin/env node
/**
 * 启动 Electron 的包装脚本。
 *
 * 某些终端/CI 环境会全局设置 ELECTRON_RUN_AS_NODE=1，导致 Electron 以纯 Node 模式运行，
 * 表现为 require('electron').app 为 undefined。这里在 spawn 前显式移除该变量。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error('启动 Electron 失败：', error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
