#!/usr/bin/env node
/**
 * Build the headless server entry.
 *
 * Runtime dependencies (better-sqlite3, 7zip-bin, mkcert, etc.) stay external
 * and are shipped beside dist/headless by the Windows Server installer.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync('dist/headless', { recursive: true });
await build({
  entryPoints: ['src/server-entry/index.ts'],
  outfile: 'dist/headless/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
});
console.log(`headless bundle: ${path.resolve('dist/headless/index.mjs')}`);
