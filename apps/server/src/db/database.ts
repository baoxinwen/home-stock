import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

/** SQLite 主库文件名（规格第 6 节：/data/stock.db）。 */
export const DB_FILE_NAME = 'stock.db';

/**
 * 解析数据库文件路径：
 * env DATA_DIR（容器内 /data）+ stock.db；未设置时默认 ./data/stock.db。
 */
export function resolveDbPath(dataDir?: string): string {
  const dir = dataDir ?? process.env.DATA_DIR ?? join('.', 'data');
  return join(resolve(dir), DB_FILE_NAME);
}

/**
 * 打开 SQLite 连接（better-sqlite3）：
 * - 自动创建 DATA_DIR 目录与库文件
 * - 开启 WAL 模式（规格：SQLite 启用 WAL）
 * - 开启外键约束
 */
export function openDatabase(dbPath?: string): Database.Database {
  const path = dbPath ?? resolveDbPath();
  mkdirSync(join(path, '..'), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
