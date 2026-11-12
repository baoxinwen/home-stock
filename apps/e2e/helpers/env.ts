/**
 * e2e 运行环境常量：路径、口令、端口。config / global-setup / specs 共用。
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** apps/e2e 目录 */
export const E2E_ROOT = resolve(__dirname, '..');
/** 仓库根目录 */
export const REPO_ROOT = resolve(E2E_ROOT, '..', '..');
/** server 运行端口（apps/server/src/main.ts 固定 listen 3000） */
export const SERVER_PORT = 3000;
export const BASE_URL = `http://localhost:${SERVER_PORT}`;
/** 每次运行的数据根目录（其下按 run 分目录；.gitignore 已覆盖） */
export const E2E_DATA_ROOT = resolve(E2E_ROOT, '.e2e-data');
/** 当前 run 目录的落盘标记（config 与 globalSetup/Teardown 跨上下文共享） */
const CURRENT_RUN_FILE = resolve(E2E_DATA_ROOT, '.current-run');
/** 登录态存储文件（auth.setup 写入，mobile/desktop 复用） */
export const E2E_AUTH_STATE_FILE = resolve(E2E_ROOT, '.auth', 'state.json');
/** 截图输出目录（brief 交付物 7：仓库根 .superpowers-shots/） */
export const SHOTS_DIR = resolve(REPO_ROOT, '.superpowers-shots');
/** 部署时设置的访问口令（语义同 docker-compose 的 ACCESS_TOKEN） */
export const ACCESS_TOKEN = 'family-secret-01';

/**
 * 生成本次运行的 DATA_DIR：唯一命名（run-<ts>-<rand>），天然是全新 SQLite 库。
 * 实测 Playwright 在 globalSetup / globalTeardown 时 webServer 仍存活并持有库文件句柄，
 * 因此「全新」由唯一性保证；旧 run 目录由 pruneStaleRunDirs 尽力清理（服务停止后删除才成功）。
 */
export function newRunDataDir(): string {
  const dir = resolve(E2E_DATA_ROOT, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(E2E_DATA_ROOT, { recursive: true });
  writeFileSync(CURRENT_RUN_FILE, dir, 'utf8');
  return dir;
}

/** 读取本次 run 目录（config 已写入标记；供 global-setup / global-teardown 使用） */
export function currentRunDataDir(): string {
  try {
    return readFileSync(CURRENT_RUN_FILE, 'utf8').trim();
  } catch {
    return resolve(E2E_DATA_ROOT, 'run-fallback');
  }
}

export function runBackupDir(dataDir: string): string {
  return join(dataDir, 'backups');
}

/** 尽力清理陈旧 run- 目录（排除 keep）；失败不阻塞——下一轮还会再试 */
export function pruneStaleRunDirs(keep: string): void {
  let entries: string[];
  try {
    entries = readdirSync(E2E_DATA_ROOT);
  } catch {
    return; // 根目录尚不存在
  }
  for (const name of entries) {
    if (!name.startsWith('run-') || name === keep.split(/[\\/]/).pop()) continue;
    try {
      rmSync(resolve(E2E_DATA_ROOT, name), { recursive: true, force: true });
    } catch {
      // 句柄未释放（罕见）：留给下一轮清理
    }
  }
}

/**
 * globalSetup 的准备工作：截图目录 + 陈旧 run 目录清理。
 * 注意：build 不在这里做——Playwright 的 webServer 先于 globalSetup 启动，放这里会导致
 * 当次 server 跑上一次的 dist（fresh clone 则直接启动失败）。构建已并入
 * webServer.command（`pnpm -r build && node dist/src/main.js`），时序天然正确。
 */
export function prepareWorkspace(currentRunDir: string): void {
  rmSync(E2E_AUTH_STATE_FILE, { force: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  pruneStaleRunDirs(currentRunDir);
}
