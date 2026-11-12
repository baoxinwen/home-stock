/**
 * Playwright 系统测试配置（规格第 10 节 + 第 12 节阶段 7 第 26 步）：
 * - 双项目视口：mobile 375×667、desktop 1280×720
 * - webServer fixture：全局 build 后启动真实 server（每次跑测全新 SQLite 库）
 * - 唯一新依赖 @playwright/test + chromium（规格 §10 已锁定）
 */
import { resolve } from 'node:path';
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { ACCESS_TOKEN, E2E_AUTH_STATE_FILE, SERVER_PORT, newRunDataDir, runBackupDir } from './helpers/env';

export const BASE_URL = `http://localhost:${SERVER_PORT}`;

/** 本次运行的 DATA_DIR：唯一命名，天然全新库（见 helpers/env.ts run 目录策略） */
const E2E_DATA_DIR = newRunDataDir();
const E2E_BACKUP_DIR = runBackupDir(E2E_DATA_DIR);

const config: PlaywrightTestConfig = defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: resolve(__dirname, '.report') }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'mobile',
      testIgnore: /auth\.setup\.ts/,
      use: {
        viewport: { width: 375, height: 667 },
        storageState: E2E_AUTH_STATE_FILE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'desktop',
      testIgnore: /auth\.setup\.ts/,
      use: {
        viewport: { width: 1280, height: 720 },
        storageState: E2E_AUTH_STATE_FILE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // build 与启动同链执行（评审 Important 1）：webServer 先于 globalSetup 启动，
    // build 放 globalSetup 会让当次 server 跑旧 dist、fresh clone 直接启动失败；
    // 放在 command 里保证「先构建出最新 dist 再启动」，timeout 覆盖构建耗时。
    command: 'pnpm -r build && node dist/src/main.js',
    cwd: resolve(__dirname, '..', 'server'),
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    // 一律不复用：复用会连同 3000 端口上残留进程的旧数据库一起接管，且可能挤掉
    // 正在运行的服务（已三次造成 e2e 假失败/误杀演示实例）。端口被占即直接报错，
    // 由人清理后重跑，保证「每次跑测全新库」的前提不被绕过。
    reuseExistingServer: false,
    env: {
      DATA_DIR: E2E_DATA_DIR,
      BACKUP_DIR: E2E_BACKUP_DIR,
      ACCESS_TOKEN,
      NODE_ENV: 'development',
      PUBLIC_DIR: resolve(__dirname, '..', 'web', 'dist'),
    },
  },
});

export default config;
