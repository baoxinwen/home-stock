/**
 * Task8 Fix Round 1（I2）— 恢复替换的崩溃窗口与启动对账。
 * 原子替换后不应出现「主库缺失」中间态；若遗留 .old-<ts>/.new，启动时必须回滚/清理并告警，不能静默建空库。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createDb } from '../src/db';
import { items } from '../src/db/schema';
import { reconcileDatabaseFiles } from '../src/db/reconcile';
import { createApplication } from '../src/bootstrap';

let dir: string;
let main: string;
let backupDir: string;

function seedDb(name: string): void {
  const db = createDb(main);
  db.insert(items).values({ name, quantity: 1 }).run();
  (db as unknown as { $client: { close(): void } }).$client.close();
}

function countItems(): number {
  const db = createDb(main);
  const rows = db.select().from(items).all();
  (db as unknown as { $client: { close(): void } }).$client.close();
  return rows.length;
}

function removeMainAndSidecars(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${main}${suffix}`)) rmSync(`${main}${suffix}`, { force: true });
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homestock-reconcile-'));
  main = join(dir, 'stock.db');
  backupDir = join(dir, 'backups');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('reconcileDatabaseFiles（I2 启动对账）', () => {
  it('主库缺失 + .old-* 残留 → 回滚旧库，数据完整', () => {
    seedDb('回滚前的牛奶');
    const old = `${main}.old-20260101-000000-000`;
    copyFileSync(main, old);
    removeMainAndSidecars();

    const result = reconcileDatabaseFiles(main);
    expect(result.action).toBe('restored-old');
    expect(result.messages.join('\n')).toContain('回滚');
    expect(existsSync(main)).toBe(true);
    expect(countItems()).toBe(1);
  });

  it('主库缺失 + .old-* + .new 残留 → 旧库优先，并清理 .new', () => {
    seedDb('旧库数据');
    const old = `${main}.old-20260101-000000-000`;
    copyFileSync(main, old);
    writeFileSync(`${main}.new`, Buffer.from('partial-new'));
    removeMainAndSidecars();

    const result = reconcileDatabaseFiles(main);
    expect(result.action).toBe('restored-old');
    expect(existsSync(`${main}.new`)).toBe(false);
    expect(countItems()).toBe(1);
  });

  it('主库完整 + .new 残留 → 删除 .new，保留主库', () => {
    seedDb('主库数据');
    writeFileSync(`${main}.new`, Buffer.from('stale-pending'));

    const result = reconcileDatabaseFiles(main);
    expect(result.action).toBe('removed-pending');
    expect(existsSync(`${main}.new`)).toBe(false);
    expect(countItems()).toBe(1);
  });

  it('主库完整 + .old-* 残留 → 保留主库并清理旧文件（告警）', () => {
    seedDb('主库数据');
    const old = `${main}.old-20260101-000000-000`;
    copyFileSync(main, old);

    const result = reconcileDatabaseFiles(main);
    expect(result.action).toBe('kept-main');
    expect(result.messages.join('\n')).toContain('旧库');
    expect(existsSync(old)).toBe(false);
    expect(countItems()).toBe(1);
  });

  it('主库缺失且只有损坏的 .new → 启动报错，不静默新建空库', async () => {
    writeFileSync(`${main}.new`, Buffer.from('definitely not sqlite'));
    const result = reconcileDatabaseFiles(main);
    expect(result.action).toBe('error');
    expect(existsSync(main)).toBe(false);

    await expect(
      createApplication({
        dbPath: main,
        accessToken: null,
        scheduler: false,
        publicDir: null,
        backupDir,
      }),
    ).rejects.toThrow(/主库/);
  });

  it('主库缺失 + 仅损坏的 .old-* 残留 → 按全新安装处理，但给出告警', () => {
    writeFileSync(`${main}.old-20260101-000000-000`, Buffer.from('definitely not sqlite'));

    const result = reconcileDatabaseFiles(main);
    // 数据已不可救：不阻塞启动（action 仍为 none），但绝不能静默
    expect(result.action).toBe('none');
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.join('\n')).toContain('全新安装');
  });

  it('启动装配路径同样回滚：createApplication 后 API 读到旧数据而非空库', async () => {
    seedDb('启动回滚牛奶');
    const old = `${main}.old-20260101-000000-000`;
    copyFileSync(main, old);
    removeMainAndSidecars();

    const { app, handle } = await createApplication({
      dbPath: main,
      accessToken: null,
      scheduler: false,
      publicDir: null,
      backupDir,
    });
    const res = await request(app.getHttpServer()).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body.data.map((i: { name: string }) => i.name)).toEqual(['启动回滚牛奶']);
    await app.close();
    handle.close();
    // 旧库文件已被消费，没有留下 .old-* 残骸
    expect(readdirSync(dir).filter((n) => n.includes('.old-'))).toHaveLength(0);
  });
});
