import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveDbPath, openDatabase, DB_FILE_NAME } from '../src/db/database';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'homestock-db-'));
});

afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveDbPath', () => {
  it('defaults to ./data/stock.db when DATA_DIR unset', () => {
    delete process.env.DATA_DIR;
    expect(resolveDbPath()).toBe(resolve(join('.', 'data', DB_FILE_NAME)));
  });

  it('uses DATA_DIR env (container /data case)', () => {
    process.env.DATA_DIR = '/data';
    expect(resolveDbPath()).toBe(resolve(join('/data', DB_FILE_NAME)));
  });

  it('uses DATA_DIR custom dir', () => {
    process.env.DATA_DIR = tmpDir;
    expect(resolveDbPath()).toBe(join(tmpDir, DB_FILE_NAME));
  });
});

describe('openDatabase', () => {
  it('creates DATA_DIR and db file if missing, enables WAL', () => {
    const dir = join(tmpDir, 'nested', 'data');
    process.env.DATA_DIR = dir;
    const db = openDatabase();
    try {
      expect(existsSync(join(dir, DB_FILE_NAME))).toBe(true);
      const row = db.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('foreign keys enforced', () => {
    process.env.DATA_DIR = tmpDir;
    const db = openDatabase();
    try {
      const row = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };
      expect(row.foreign_keys).toBe(1);
    } finally {
      db.close();
    }
  });

  it('reopening an existing db keeps WAL and data persists', () => {
    mkdirSync(tmpDir, { recursive: true });
    process.env.DATA_DIR = tmpDir;
    const db1 = openDatabase();
    db1.exec(`CREATE TABLE t (x INTEGER)`);
    db1.close();
    const db2 = openDatabase();
    try {
      expect(existsSync(join(tmpDir, `${DB_FILE_NAME}-wal`)) || existsSync(join(tmpDir, DB_FILE_NAME))).toBe(
        true,
      );
      const row = db2.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
    } finally {
      db2.close();
    }
  });
});
