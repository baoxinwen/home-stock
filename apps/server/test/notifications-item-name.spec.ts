/**
 * I-6 RED — 通知携带物品名（跨端契约缺口）。
 * 提醒扫描落库时快照物品名；GET /api/notifications 的 DTO 带出 itemName。
 * 历史存量（迁移回填不到的行，如物品已删）itemName 为 null，展示层退化为仅类型标题。
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

/** 明天（本地日期，保证进入临期窗口且不会被自动归档） */
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('GET /api/notifications 携带 itemName（I-6）', () => {
  it('提醒扫描后，通知 DTO 返回写入时快照的物品名', async () => {
    ctx.sqlite
      .prepare(`INSERT INTO items (name, quantity, status, expiry_date) VALUES ('临期牛奶', 1, 'active', ?)`)
      .run(tomorrowISO());

    const run = await post('/api/reminders/run');
    expect(run.status).toBe(200);
    expect(run.body.data.notified).toBe(1);

    const res = await get('/api/notifications');
    expect(res.status).toBe(200);
    const list = res.body.data as { itemId: number; itemName: string | null; type: string }[];
    const hit = list.find((n) => n.itemName !== undefined);
    expect(hit).toBeDefined();
    expect(hit!.itemName).toBe('临期牛奶');
    expect(hit!.type).toBe('expiring_soon');
  });

  it('存量无物品名（回填不到）的行 → itemName 为 null，不误报', async () => {
    // 直接造一行“迁移前”形态的通知（item_id 悬空、无 item_name）
    ctx.sqlite
      .prepare(`INSERT INTO notifications (item_id, type, sent_date, read) VALUES (424242, 'expired', '2020-01-01', 1)`)
      .run();
    const res = await get('/api/notifications');
    expect(res.status).toBe(200);
    const list = res.body.data as { itemId: number; itemName: string | null }[];
    const row = list.find((n) => n.itemId === 424242);
    expect(row).toBeDefined();
    expect(row!.itemName).toBeNull();
  });
});
