import { cpSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist/main', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron', 'better-sqlite3', '@mkcert/node', 'node-7z', '7zip-bin', 'clamscan'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/main.cjs',
});

await build({
  ...common,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/main/preload.cjs',
});

cpSync('src/plugin-runtime/child.cjs', 'dist/main/plugin-child.cjs');
cpSync('src/plugin-runtime/child.cjs', 'resources/bin/plugin-child.cjs');

// 迁移 SQL 作为资源复制到主进程产物旁边（打包后仍可读取）
cpSync('src/core/db/migrations', 'dist/main/migrations', { recursive: true });

console.log('Electron main/preload bundled to dist/main');
