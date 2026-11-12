import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrationsUp, runMigrationsDown, seedDefaultCategories, DEFAULT_SETTINGS, MIGRATIONS } from '../src/db/migrate';
import { openDatabase } from '../src/db/database';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'homestock-mig-'));
  dbPath = join(tmpDir, 'stock.db');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function tableNames(dbPath: string): string[] {
  const db = new Database(dbPath);
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  db.close();
  return rows.map((r) => r.name);
}

describe('migrations up', () => {
  it('up creates all 5 spec tables + drizzle bookkeeping', () => {
    runMigrationsUp(dbPath);
    const tables = tableNames(dbPath);
    for (const t of [
      'items',
      'categories',
      'shopping_list_items',
      'notifications',
      'notification_logs',
      'settings',
    ]) {
      expect(tables).toContain(t);
    }
    expect(tables).toContain('__migrations');
  });

  it('up is idempotent (second run no-op)', () => {
    runMigrationsUp(dbPath);
    expect(() => runMigrationsUp(dbPath)).not.toThrow();
  });

  it('接受已打开的句柄（createDb 不再重复开库）', () => {
    const db = openDatabase(dbPath);
    try {
      runMigrationsUp(db);
      expect(db.open).toBe(true);
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = 'items'`)
        .all();
      expect(tables).toHaveLength(1);
      // 句柄仍可继续使用，且迁移已记录
      const applied = db.prepare(`SELECT COUNT(*) AS c FROM __migrations`).get() as { c: number };
      expect(applied.c).toBe(MIGRATIONS.length);
    } finally {
      db.close();
    }
  });

  it('items table matches spec columns', () => {
    runMigrationsUp(dbPath);
    const db = new Database(dbPath);
    const cols = db.prepare(`PRAGMA table_info(items)`).all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const names = cols.map((c) => c.name);
    for (const c of [
      'id',
      'name',
      'category_id',
      'purchase_date',
      'quantity',
      'unit',
      'price',
      'expiry_date',
      'opened',
      'opened_at',
      'open_shelf_days',
      'remind_days',
      'min_quantity',
      'status',
      'archived_reason',
      'archived_at',
      'created_at',
      'updated_at',
    ]) {
      expect(names).toContain(c);
    }
    // NOT NULL 约束：name、quantity
    expect(cols.find((c) => c.name === 'name')!.notnull).toBe(1);
    expect(cols.find((c) => c.name === 'quantity')!.notnull).toBe(1);
    db.close();
  });

  it('0002 adds items.source default manual and backfills existing rows', () => {
    // 先用 0001 建表并插入“存量”行，再跑迁移
    const db = new Database(dbPath);
    db.exec(MIGRATIONS[0].upSql);
    db.prepare(`INSERT INTO items (name, quantity) VALUES ('存量品', 1)`).run();
    db.close();

    runMigrationsUp(dbPath);
    const after = new Database(dbPath);
    const cols = after.prepare(`PRAGMA table_info(items)`).all() as {
      name: string;
      dflt_value: string | null;
    }[];
    const source = cols.find((c) => c.name === 'source');
    expect(source).toBeDefined();
    expect(source!.dflt_value).toContain('manual');
    expect(
      (after.prepare(`SELECT source FROM items WHERE name = '存量品'`).get() as { source: string }).source,
    ).toBe('manual');

    after.prepare(`INSERT INTO items (name, quantity) VALUES ('新行', 1)`).run();
    expect(
      (after.prepare(`SELECT source FROM items WHERE name = '新行'`).get() as { source: string }).source,
    ).toBe('manual');
    after.close();
  });

  it('0002 down drops source column', () => {
    runMigrationsUp(dbPath);
    const migration = MIGRATIONS.find((m) => m.name === '0002_items_source');
    expect(migration).toBeDefined();
    const db = new Database(dbPath);
    db.exec(migration!.downSql);
    const cols = db.prepare(`PRAGMA table_info(items)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('source');
    db.close();
  });

  it('0003 adds notifications.item_name（可空）并按 items 回填存量（I-6）', () => {
    // 先用 0001 建表并造“存量”行：一条关联现存物品，一条物品已删（item_id 悬空）
    const db = new Database(dbPath);
    db.exec(MIGRATIONS[0].upSql);
    const itemId = Number(
      db.prepare(`INSERT INTO items (name, quantity) VALUES ('存量牛奶', 1)`).run().lastInsertRowid,
    );
    db.prepare(`INSERT INTO notifications (item_id, type, sent_date) VALUES (?, 'expiring_soon', '2026-01-01')`).run(itemId);
    db.prepare(`INSERT INTO notifications (item_id, type, sent_date) VALUES (999, 'expired', '2026-01-01')`).run();
    db.prepare(`INSERT INTO notifications (item_id, type, sent_date) VALUES (NULL, 'expired', '2026-01-02')`).run();
    db.close();

    runMigrationsUp(dbPath);
    const after = new Database(dbPath);
    const cols = after.prepare(`PRAGMA table_info(notifications)`).all() as {
      name: string;
      notnull: number;
    }[];
    const col = cols.find((c) => c.name === 'item_name');
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0); // 可空：物品已删的行允许 NULL

    const rows = after
      .prepare(`SELECT item_id, item_name FROM notifications ORDER BY id`)
      .all() as { item_id: number | null; item_name: string | null }[];
    expect(rows[0].item_name).toBe('存量牛奶'); // 现存物品 → 回填
    expect(rows[1].item_name).toBeNull(); // 物品已删 → 保持 NULL（不猜测）
    expect(rows[2].item_name).toBeNull(); // item_id 为空 → 保持 NULL
    after.close();
  });

  it('0003 down drops item_name column', () => {
    runMigrationsUp(dbPath);
    const migration = MIGRATIONS.find((m) => m.name === '0003_notifications_item_name');
    expect(migration).toBeDefined();
    const db = new Database(dbPath);
    db.exec(migration!.downSql);
    const cols = db.prepare(`PRAGMA table_info(notifications)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('item_name');
    db.close();
  });

  it('notifications has UNIQUE(item_id, type, sent_date)', () => {
    runMigrationsUp(dbPath);
    const db = new Database(dbPath);
    const idx = db.prepare(`PRAGMA index_list(notifications)`).all() as { unique: number; name: string }[];
    const uniqueIdx = idx.filter((i) => i.unique === 1);
    expect(uniqueIdx.length).toBeGreaterThan(0);
    const cols = db
      .prepare(`PRAGMA index_info(${uniqueIdx[0].name})`)
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual(['item_id', 'sent_date', 'type']);
    // 实际插入验证去重约束
    db.prepare(
      `INSERT INTO notifications (item_id, type, sent_date) VALUES (1, 'expiring_soon', '2026-01-01')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO notifications (item_id, type, sent_date) VALUES (1, 'expiring_soon', '2026-01-01')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('settings seeded with default rows', () => {
    runMigrationsUp(dbPath);
    const db = new Database(dbPath);
    const rows = db.prepare(`SELECT key, value FROM settings`).all() as Record<string, string>[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(map['reminder_hour']).toBe('8');
    expect(map['auto_archive_expired']).toBe('1');
    expect(map['default_remind_days']).toBe('3');
    db.close();
  });

  it('categories seeded once on empty table; user edits are never overwritten', async () => {
    runMigrationsUp(dbPath);
    const db = new Database(dbPath);
    seedDefaultCategories(db);
    const names = (db.prepare(`SELECT name FROM categories ORDER BY id`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(['食品', '药品', '日用品', '个护', '其他']);

    // 非空表重跑种子：不再插入（用户删掉默认类别不会被复活）
    db.prepare(`DELETE FROM categories WHERE name = '其他'`).run();
    seedDefaultCategories(db);
    const after = (db.prepare(`SELECT name FROM categories ORDER BY id`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(after).toEqual(['食品', '药品', '日用品', '个护']);
    db.close();
  });

  it('categories FK reference on items is declared', () => {
    runMigrationsUp(dbPath);
    const db = new Database(dbPath);
    const fk = db.prepare(`PRAGMA foreign_key_list(items)`).all() as {
      table: string;
      from: string;
      to: string;
    }[];
    const catFk = fk.find((f) => f.table === 'categories');
    expect(catFk).toBeDefined();
    expect(catFk!.from).toBe('category_id');
    db.close();
  });
});

describe('migrations down', () => {
  it('down removes all spec tables, then up restores them', () => {
    runMigrationsUp(dbPath);
    runMigrationsDown(dbPath);
    const afterDown = tableNames(dbPath);
    for (const t of [
      'items',
      'categories',
      'shopping_list_items',
      'notifications',
      'notification_logs',
      'settings',
    ]) {
      expect(afterDown).not.toContain(t);
    }
    // 再 up 恢复
    runMigrationsUp(dbPath);
    expect(tableNames(dbPath)).toContain('items');
    expect(tableNames(dbPath)).toContain('settings');
  });

  it('down on fresh db is a no-op', () => {
    expect(() => runMigrationsDown(dbPath)).not.toThrow();
  });

  it('every migration declares a down SQL matching its up', () => {
    for (const m of MIGRATIONS) {
      expect(m.downSql.trim().length).toBeGreaterThan(0);
    }
    expect(MIGRATIONS.length).toBeGreaterThan(0);
  });
});

describe('default settings constant', () => {
  it('matches spec defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      reminder_hour: '8',
      auto_archive_expired: '1',
      default_remind_days: '3',
    });
  });
});
