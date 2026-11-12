/// <reference types="vitest/config" />
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias: {
      // 开发与构建统一走 shared 源码（dist 为 CJS，rollup 命名导出检测不可靠）
      '@home-stock/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '家庭库存助手',
        short_name: '家庭库存',
        description: '家庭自托管库存助手：保质期、提醒、清单与浪费统计',
        start_url: '/',
        display: 'standalone',
        lang: 'zh-CN',
        theme_color: '#F5F5F3',
        background_color: '#F5F5F3',
        icons: [{ src: '/icons/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'happy-dom',
    passWithNoTests: true,
  },
});
