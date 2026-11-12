import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 与 web 一致：测试直接跑 shared 源码，避免依赖未提交的 dist/ 构建产物
    // （干净 checkout 下 pnpm -r test 无需先 build）
    alias: {
      '@home-stock/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  esbuild: {
    // vitest 用 esbuild 转译 TS；显式开启装饰器与 emitDecoratorMetadata（Nest DI 依赖 design:paramtypes）
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: 'ES2022',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // 集成测试每个文件都会起一个 NestJS 应用 + SQLite 实例；不设上限时高核机器
    // （12+ 逻辑核）并发 fork 会把单个 worker 的 V8 堆打爆（实测 OOM）。
    // 实测 6 并发稳定、单文件全过，取 4 留余量。
    poolOptions: {
      forks: { maxForks: 4 },
    },
  },
});
