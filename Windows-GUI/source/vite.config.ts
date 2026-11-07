import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 用户 Web 端开发配置：
 *  - root 指向 web/，构建产物输出到 dist/web（阶段 3 后期由 Express 静态托管）
 *  - /api 代理到本地 Express（默认 127.0.0.1:8686），彻底避免开发期跨域
 *  - 可通过 API_TARGET 环境变量覆盖后端地址
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.API_TARGET || 'http://127.0.0.1:8686';

  return {
    root: 'web',
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: '../dist/web',
      emptyOutDir: true,
    },
  };
});
