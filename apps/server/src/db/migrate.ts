import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { openDatabase } from './database';

/**
 * 自定义迁移体系：drizzle-kit 不原生支持 down，
 * 每条迁移显式携带 SQL 逆操作（downSql），保证 up/down 成对、可回滚。
 */

export interface Migration {
  /** 迁移名（同时用于排序记录） */
  name: string;
  /** 正向 SQL */
  upSql: string;
  /** 逆向 SQL（与 upSql 成对） */
  downSql: string;
}

/** settings 表默认值行（规格第 5 节） */
export const DEFAULT_SETTINGS: Record<string, string> = {
  reminder_hour: '8',
  auto_archive_expired: '1',
  default_remind_days: '3',
};

/** 初版迁移：建 5 张表，字段与约束严格照抄规格第 5 节。 */
export const MIGRATIONS: Migration[] = [
  {
    name: '0001_init',
    upSql: `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  purchase_date TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT,
  price REAL,
  expiry_date TEXT,
  opened INTEGER DEFAULT 0,
  opened_at TEXT,
  open_shelf_days INTEGER,
  remind_days INTEGER,
  min_quantity REAL,
  status TEXT DEFAULT 'active',
  archived_reason TEXT,
  archived_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  price REAL,
  category_id INTEGER,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,
  type TEXT,
  sent_date TEXT,
  channels TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT,
  UNIQUE(item_id, type, sent_date)
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  level TEXT,
  message TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`,
    downSql: `
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS notification_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS shopping_list_items;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS categories;
`,
  },
  {
    /**
     * 0002：物品来源标记（M5.3）。
     * - shopping = 购物清单转库存；manual = 手动录入
     * - 存量数据：ADD COLUMN 的 DEFAULT 'manual' 会自动回填全部既有行
     * - down 通过 SQLite 3.35+ 的 DROP COLUMN 回滚（better-sqlite3 13 已满足）
     */
    name: '0002_items_source',
    upSql: `ALTER TABLE items ADD COLUMN source TEXT DEFAULT 'manual';`,
    downSql: `ALTER TABLE items DROP COLUMN source;`,
  },
  {
    /**
     * 0003：通知携带物品名（I-6）。通知中心此前只能显示“临期提醒+日期”，
     * 物品名未落库。item_name 为写入时快照（reserve 时从 items.name 取）。
     *
     * 存量数据回填处置：按 item_id 关联 items 补物品名；物品已被删除（或 item_id
     * 为空）的行保持 NULL——不猜测、不编造，展示层对 NULL 退化为仅类型标题。
     * down 通过 SQLite 3.35+ 的 DROP COLUMN 回滚（同 0002，better-sqlite3 13 已满足）。
     */
    name: '0003_notifications_item_name',
    upSql: `
ALTER TABLE notifications ADD COLUMN item_name TEXT;

UPDATE notifications
   SET item_name = (SELECT items.name FROM items WHERE items.id = notifications.item_id)
 WHERE item_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM items WHERE items.id = notifications.item_id);
`,
    downSql: `ALTER TABLE notifications DROP COLUMN item_name;`,
  },
  {
    /**
     * 0004：通知「已完成」状态（对标 GitHub inbox 三态 unread→read→done）。
     * - read 只是「看过」；done 才是「处理完」——完成的通知移出收件箱
     * - markDone 同时置 read=1（完成 ⊃ 已读，badge 随之归零）
     * - 存量数据 DEFAULT 0（全部视为未完成，收件箱行为与升级前一致）
     * - down 通过 DROP COLUMN 回滚（SQLite 3.35+，better-sqlite3 13 已满足）
     */
    name: '0004_notifications_done',
    upSql: `ALTER TABLE notifications ADD COLUMN done INTEGER DEFAULT 0;`,
    downSql: `ALTER TABLE notifications DROP COLUMN done;`,
  },
];

const BOOKKEEPING_TABLE = `
CREATE TABLE IF NOT EXISTS __migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

function appliedNames(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT name FROM __migrations`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * 依次执行未应用的迁移（幂等），迁移记录写入 __migrations 表。
 * 可传入已打开的句柄（createDb 复用同一连接，避免重复开库）；传路径时自开自关，兼容既有调用。
 */
export function runMigrationsUp(target: string | Database.Database): void {
  const ownsHandle = typeof target === 'string';
  const db = typeof target === 'string' ? openDatabase(target) : target;
  try {
    db.exec(BOOKKEEPING_TABLE);
    const insert = db.prepare(`INSERT INTO __migrations (name, applied_at) VALUES (?, ?)`);
    const run = db.transaction(() => {
      for (const m of MIGRATIONS) {
        if (appliedNames(db).has(m.name)) continue;
        db.exec(m.upSql);
        insert.run(m.name, new Date().toISOString());
      }
      // settings 默认值行（规格：迁移后即有默认值，幂等）
      const seed = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) seed.run(key, value);
    });
    run();
  } finally {
    if (ownsHandle) db.close();
  }
}

/** 按逆序回滚已应用的迁移（downSql 成对逆操作），并清空迁移记录。 */
export function runMigrationsDown(dbPath: string): void {
  if (!existsSync(dbPath)) return;
  const db = openDatabase(dbPath);
  try {
    db.exec(BOOKKEEPING_TABLE);
    const del = db.prepare(`DELETE FROM __migrations WHERE name = ?`);
    const run = db.transaction(() => {
      const rows = db.prepare(`SELECT name FROM __migrations ORDER BY rowid DESC`).all() as {
        name: string;
      }[];
      for (const r of rows) {
        const m = MIGRATIONS.find((x) => x.name === r.name);
        if (m) db.exec(m.downSql);
        del.run(r.name);
      }
    });
    run();
  } finally {
    db.close();
  }
}

/** up 之后写入 settings 默认值行（幂等，INSERT OR IGNORE）。 */
export function seedDefaultSettings(db: Database.Database): void {
  const stmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    stmt.run(key, value);
  }
}

/** 常用默认类别（D-2）：全新部署开箱即有分类能力，不再「全部未分类」。 */
export const DEFAULT_CATEGORIES = ['食品', '药品', '日用品', '个护', '其他'] as const;

/**
 * 类别种子：**仅当类别表为空时**写入默认类别（首次启动）。
 * 之后用户增删改均不被种子干扰（含故意删掉默认类别——不复活）。
 */
export function seedDefaultCategories(db: Database.Database): void {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM categories`).all() as { n: number }[];
  if ((existing[0]?.n ?? 0) > 0) return;
  const stmt = db.prepare(`INSERT INTO categories (name) VALUES (?)`);
  const insert = db.transaction(() => {
    for (const name of DEFAULT_CATEGORIES) {
      stmt.run(name);
    }
  });
  insert();
}
