import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../src/db';
import { items, settings, categories } from '../src/db/schema';
import type Database from 'better-sqlite3';

let tmpDir: string;
let client: Database.Database | undefined;

function closeClient(db: unknown) {
  client = (db as { $client?: Database.Database } | undefined)?.$client;
  if (client) client.close();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'homestock-createdb-'));
});

afterEach(() => {
  delete process.env.DATA_DIR;
  if (client) {
    client.close();
    client = undefined;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createDb (drizzle handle)', () => {
  it('returns typed drizzle handle able to insert/select via schema', () => {
    const db = createDb(join(tmpDir, 'stock.db'));
    try {
      db.insert(items).values({ name: '牛奶', quantity: 2, unit: '盒' }).run();
      const rows = db.select().from(items).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('牛奶');
      expect(rows[0].status).toBe('active');
      closeClient(db);
    } catch (e) {
      closeClient(db);
      throw e;
    }
  });

  it('creates db file and seeds default settings', () => {
    const path = join(tmpDir, 'stock.db');
    const db = createDb(path);
    try {
      expect(existsSync(path)).toBe(true);
      const rows = db.select().from(settings).all();
      const map = Object.fromEntries(
        rows.map((r: { key: string; value: string | null }) => [r.key, r.value]),
      );
      expect(map['reminder_hour']).toBe('8');
      expect(map['auto_archive_expired']).toBe('1');
      expect(map['default_remind_days']).toBe('3');
      closeClient(db);
    } catch (e) {
      closeClient(db);
      throw e;
    }
  });

  it('category FK enforced on insert', () => {
    const db = createDb(join(tmpDir, 'stock.db'));
    try {
      db.insert(categories).values({ name: '食品' }).run();
      const cat = db.select().from(categories).all()[0];
      expect(() =>
        db.insert(items).values({ name: 'x', quantity: 1, categoryId: cat.id + 999 }).run(),
      ).toThrow();
      closeClient(db);
    } catch (e) {
      closeClient(db);
      throw e;
    }
  });
});
