/**
 * 0004 通知「已完成」状态（GitHub inbox done 语义）：
 * POST /notifications/done（ids 缺省=全部；完成同时置 read=1，badge 归零）；
 * POST /notifications/undone 恢复；done 不影响「终身一次」去重；
 * DTO 带出 done 字段。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

const get = (url: string) => request(ctx.app.getHttpServer()).get(url);
const post = (url: string, body?: unknown) => request(ctx.app.getHttpServer()).post(url).send(body ?? {});

/** 直插一条通知（绕过提醒扫描，聚焦状态机本身） */
function insertNotification(id: number, read = 0): void {
  ctx.sqlite
    .prepare(
      `INSERT INTO notifications (id, item_id, item_name, type, sent_date, read, done, created_at)
       VALUES (?, ?, ?, 'expiring_soon', '2026-01-01', ?, 0, '2026-01-01T08:00:00')`,
    )
    .run(id, 100 + id, `物品${id}`, read);
}

async function listAll() {
  const res = await get('/api/notifications');
  expect(res.status).toBe(200);
  return res.body.data as { id: number; itemId: number; read: number; done: number }[];
}

describe('POST /api/notifications/done（0004 三态收件箱）', () => {
  it('单条完成：done=1 + 同时置已读（unreadCount 归零），DTO 带出 done', async () => {
    insertNotification(1, 0);

    const res = await post('/api/notifications/done', { ids: [1] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);

    const rows = await listAll();
    const row = rows.find((n) => n.id === 1)!;
    expect(row.done).toBe(1);
    expect(row.read).toBe(1); // 完成 ⊃ 已读

    const unread = await get('/api/notifications?unread=1');
    expect((unread.body.data as unknown[]).length).toBe(0);
  });

  it('ids 子集只完成指定行；幂等（重复完成 updated=0）', async () => {
    insertNotification(2, 0);
    insertNotification(3, 0);

    const res = await post('/api/notifications/done', { ids: [2] });
    expect(res.body.data.updated).toBe(1);
    const rows = await listAll();
    expect(rows.find((n) => n.id === 2)!.done).toBe(1);
    expect(rows.find((n) => n.id === 3)!.done).toBe(0);

    const again = await post('/api/notifications/done', { ids: [2] });
    expect(again.body.data.updated).toBe(0); // 幂等
  });

  it('无 ids = 全部完成', async () => {
    insertNotification(4, 0);
    insertNotification(5, 0);

    const res = await post('/api/notifications/done');
    expect(res.body.data.updated).toBeGreaterThanOrEqual(2);
    const rows = await listAll();
    expect(rows.filter((n) => n.done === 1).length).toBe(rows.length);
    expect(rows.every((n) => n.read === 1)).toBe(true);
  });

  it('undone 恢复到收件箱：仅清 done，read 保持', async () => {
    insertNotification(6, 1);
    await post('/api/notifications/done', { ids: [6] });

    const res = await post('/api/notifications/undone', { ids: [6] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    const row = (await listAll()).find((n) => n.id === 6)!;
    expect(row.done).toBe(0);
    expect(row.read).toBe(1); // 看过的还是看过
  });

  it('done 不影响「终身一次」去重：ledger.hasAny 仍命中，扫描不重发', async () => {
    // 物品 11 临期 → 扫描发通知 → 完成 → 再扫描
    ctx.sqlite
      .prepare(
        `INSERT INTO items (id, name, quantity, status, expiry_date) VALUES (11, '临期牛奶', 1, 'active', '2026-01-03')`,
      )
      .run();
    const first = await post('/api/reminders/run');
    expect(first.body.data.notified).toBe(1);

    const list = await listAll();
    const target = list.find((n) => n.itemId === 11)!;
    await post('/api/notifications/done', { ids: [target.id] });

    const second = await post('/api/reminders/run');
    expect(second.body.data.notified).toBe(0); // 已完成 ≠ 允许重发
  });
});

describe('I-1 空 ids 数组语义统一为 no-op（不可逆操作防误伤）', () => {
  it('POST read {ids:[]} → no-op，不静默清空全部未读', async () => {
    insertNotification(21, 0);
    insertNotification(22, 0);

    const res = await post('/api/notifications/read', { ids: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(0); // RED：现状落全量分支 updated=2

    const unread = await get('/api/notifications?unread=1');
    expect((unread.body.data as unknown[]).length).toBe(2); // 未读保持
  });

  it('POST done {ids:[]} → 同为 no-op', async () => {
    insertNotification(23, 0);

    const res = await post('/api/notifications/done', { ids: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(0); // RED：现状全量完成

    const row = (await listAll()).find((n) => n.id === 23)!;
    expect(row.done).toBe(0);
    expect(row.read).toBe(0);
  });

  it('POST undone {ids:[]} → no-op（既有语义，回归锁定）', async () => {
    insertNotification(24, 1);
    await post('/api/notifications/done', { ids: [24] });
    const res = await post('/api/notifications/undone', { ids: [] });
    expect(res.body.data.updated).toBe(0);
    expect((await listAll()).find((n) => n.id === 24)!.done).toBe(1);
  });
});
