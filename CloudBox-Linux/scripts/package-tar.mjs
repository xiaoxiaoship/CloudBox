#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const version = process.env.npm_package_version ?? '0.1.0';
const output = path.resolve(`cloudbox-linux-${version}.tar.gz`);
mkdirSync(path.dirname(output), { recursive: true });
const files = [
  'src',
  'dist/web',
  'resources',
  'package.json',
  'tsconfig.json',
  'install.sh',
  'cloudbox.service',
  'bin',
  'README.md',
].filter(Boolean);
const result = spawnSync('tar', ['-czf', output, ...files], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Created ${output}`);
