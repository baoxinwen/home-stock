/// <reference types="vitest/config" />
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { version } from './package.json';

export default defineConfig({
  // 设置页展示当前版本（SW 场景下「在跑哪个版」是排查刚需）
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
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
      // prompt：发现新版本不静默接管，由 UpdateToast 提示用户点刷新后生效，
      // 封死「旧代码 + 新接口 schema」的窗口期
      registerType: 'prompt',
      // 注册收进应用内（UpdateToast → virtual:pwa-register），不再自动注入 registerSW.js
      injectRegister: null,
      workbox: {
        // SPA history 路由：离线冷启动/深链刷新时导航请求回退壳页（服务端兜底只在线生效）
        navigateFallback: 'index.html',
        // API 与上传资源各有语义，绝不回退壳页
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        // 显式声明不赌默认值：发版清旧缓存；activate 后接管无主页面（首次安装立即受控）
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // 只读离线快照（reno 同款思路）：核心读接口 NetworkFirst——在线永远取最新，
        // 断网落上次成功响应；写请求（POST 等）不在此列，天然不缓存。
        // urlPattern 两坑（2026-11-20 双踩后在案）：
        // ① generateSW 只把函数体**文本**序列化进 sw.js——闭包引用的外部变量在 SW 作用域
        //    不存在 → ReferenceError、快照静默失效；② workbox 的 RegExp pattern 匹配
        //    **完整 URL（href）**而非 pathname，带 ^ 锚的正则永远匹配不上。
        // 正解：自包含函数（正则内联、测 pathname），reno 同款写法
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /^\/api\/(items|categories|shopping-items)\/?$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'home-stock-snapshot',
              expiration: { maxEntries: 30, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [200] }, // 错误响应绝不进快照
            },
          },
        ],
      },
      manifest: {
        // W3C 建议显式 id：防改名/换 start_url 后浏览器视为另一个应用（旧安装不升级的身份漂移）
        id: '/',
        name: '家庭库存助手',
        short_name: '家庭库存',
        description: '家庭自托管库存助手：保质期、提醒、清单与浪费统计',
        start_url: '/',
        display: 'standalone',
        lang: 'zh-CN',
        theme_color: '#F5F5F3',
        background_color: '#F5F5F3',
        icons: [
          { src: '/icons/icon.svg', type: 'image/svg+xml', sizes: 'any' },
          // 同文件复用作 maskable：glyph 最远点 187px+14px 描边 < 512 系 205px 安全区，已实测核算
          { src: '/icons/icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'maskable' },
        ],
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
