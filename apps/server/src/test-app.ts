/**
 * 测试/冒烟用 app 工厂：显式传入 SQLite 路径（临时库），返回 { app, sqlite }。
 * 生产入口 main.ts 走 createApp()（默认 DATA_DIR / env 口令）。
 */
import type Database from 'better-sqlite3';
import { createApplication } from './bootstrap';
import type { ReopenableDbHandle } from './db/handle';

export interface TestAppOptions {
  /** 访问口令；默认 null（测试不开启鉴权），需要鉴权的用例显式传入 */
  accessToken?: string | null;
  backupDir?: string;
  publicDir?: string | null;
}

export interface TestApp {
  app: Awaited<ReturnType<typeof createApplication>>['app'];
  sqlite: Database.Database;
  handle: ReopenableDbHandle;
  dbPath: string;
}

export async function createTestApp(dbPath: string, options: TestAppOptions = {}): Promise<TestApp> {
  const { app, handle } = await createApplication({
    dbPath,
    accessToken: options.accessToken ?? null,
    backupDir: options.backupDir,
    scheduler: false,
    publicDir: options.publicDir ?? null,
  });
  return {
    app,
    sqlite: handle.sqlite,
    handle: handle as ReopenableDbHandle,
    dbPath,
  };
}
