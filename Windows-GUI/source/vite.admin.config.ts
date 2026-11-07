import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** 管理员窗口通过 file:// 加载，base 必须是相对路径 */
export default defineConfig({
  root: 'admin',
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
  },
});
