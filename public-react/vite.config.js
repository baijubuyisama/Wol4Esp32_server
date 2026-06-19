import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dev: Vite 跑在 5173,把 /ws 请求代理到后端 3000,开发时前后端可独立热更新
// prod: vite build 产出 dist/,由 server.js (express.static) 直接托管
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      // 代理其他后端 API(预留)
      '/api': 'http://localhost:3000',
    },
  },
});
