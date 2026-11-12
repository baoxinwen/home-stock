import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { openDatabase, resolveDbPath } from './database';
import * as schema from './schema';
import { runMigrationsUp, seedDefaultCategories, seedDefaultSettings } from './migrate';

export * from './schema';
export { resolveDbPath, openDatabase, DB_FILE_NAME } from './database';
export {
  runMigrationsUp,
  runMigrationsDown,
  seedDefaultSettings,
  seedDefaultCategories,
  DEFAULT_SETTINGS,
} from './migrate';

/** 类型安全的 Drizzle 数据库句柄（better-sqlite3 驱动）。 */
export type Db = BetterSQLite3Database<typeof schema>;

/**
 * 创建 Drizzle 句柄：打开 SQLite（WAL）+ 迁移 up + 默认设置/类别种子。
 * 迁移复用同一连接（不再二次开库）。应用启动入口（bootstrap）调用一次。
 */
export function createDb(dbPath?: string): Db {
  const path = dbPath ?? resolveDbPath();
  const sqlite = openDatabase(path);
  runMigrationsUp(sqlite);
  seedDefaultSettings(sqlite);
  seedDefaultCategories(sqlite);
  return drizzle(sqlite, { schema });
}
