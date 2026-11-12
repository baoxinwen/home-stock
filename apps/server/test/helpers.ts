/**
 * API 集成测试基座：临时 SQLite + createDb + Nest app（supertest）。
 * 每个测试文件独立临时库，测试互不干扰。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from '../src/test-app';
import type { ReopenableDbHandle } from '../src/db/handle';

export interface TestCtx {
  app: INestApplication;
  /** 直连 better-sqlite3 句柄（非恢复类用例可直接操作库）；恢复后请用 ctx.handle.sqlite */
  sqlite: Database.Database;
  /** 可重开句柄：恢复测试后用它拿当前连接 */
  handle: ReopenableDbHandle;
  dbPath: string;
  backupDir: string;
  /** 临时目录（teardown 清理） */
  dir: string;
}

export interface StartTestAppOptions {
  /** 访问口令；默认 null（关闭鉴权） */
  accessToken?: string | null;
  /** 备份目录；默认接在临时目录下 */
  backupDir?: string;
}

export async function startTestApp(options: StartTestAppOptions = {}): Promise<TestCtx> {
  const dir = mkdtempSync(join(tmpdir(), 'homestock-api-'));
  const dbPath = join(dir, 'stock.db');
  const backupDir = options.backupDir ?? join(dir, 'backups');
  const { app, sqlite, handle } = await createTestApp(dbPath, {
    accessToken: options.accessToken ?? null,
    backupDir,
  });
  return { app, sqlite, handle, dbPath, backupDir, dir };
}

export async function stopTestApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
  ctx.handle.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}
