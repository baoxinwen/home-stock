import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

async function createItem(body: Record<string, unknown>) {
  const res = await request(ctx.app.getHttpServer()).post('/api/items').send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('POST /api/items', () => {
  it('创建最小物品（name 必填，quantity 默认 0，status=active，source=manual）', async () => {
    const item = await createItem({ name: '牛奶' });
    expect(item).toMatchObject({ name: '牛奶', quantity: 0, status: 'active', opened: 0, source: 'manual' });
    expect(item.createdAt).toBeTruthy();
    expect(item.updatedAt).toBeTruthy();
    expect(item.effectiveExpiryDate).toBeNull();
    expect(item.expiryStatus).toBe('none');
  });

  it('全字段创建：含过期日与临期状态计算', async () => {
    const item = await createItem({
      name: '酸奶',
      quantity: 3,
      unit: '盒',
      price: 9.9,
      expiryDate: '2030-01-01',
      categoryId: null,
    });
    expect(item.effectiveExpiryDate).toBe('2030-01-01');
    expect(item.expiryStatus).toBe('ok');
  });

  it('name 缺失/空白 → 400 VALIDATION_ERROR', async () => {
    for (const body of [{}, { name: '' }, { name: '  ' }]) {
      const res = await request(ctx.app.getHttpServer()).post('/api/items').send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('name 非字符串（null/数字）→ 400 而非 500 或静默转字符串（M1）', async () => {
    for (const body of [{ name: null }, { name: 123 }]) {
      const res = await request(ctx.app.getHttpServer()).post('/api/items').send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    // 500（null 撞 NOT NULL）或静默入库 "null"/"123" 都不允许
    const list = await request(ctx.app.getHttpServer()).get('/api/items');
    expect(list.body.data.some((i: { name: string }) => ['null', '123'].includes(i.name))).toBe(false);
  });

  it('name 前后空格 → 创建落库为 trim 值（M8，与 categories/shopping 一致）', async () => {
    const item = await createItem({ name: '  牛奶  ' });
    expect(item.name).toBe('牛奶');
  });

  it('负数 quantity → 400；超大 quantity 接受（极值）', async () => {
    const neg = await request(ctx.app.getHttpServer()).post('/api/items').send({ name: 'x', quantity: -1 });
    expect(neg.status).toBe(400);
    expect(neg.body.code).toBe('VALIDATION_ERROR');
    const big = await createItem({ name: '大米', quantity: 999999999 });
    expect(big.quantity).toBe(999999999);
  });

  it('非法 expiry_date → 400 VALIDATION_ERROR', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/items').send({ name: 'x', expiryDate: '2026-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('非法 categoryId → 400 VALIDATION_ERROR', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/items').send({ name: 'x', categoryId: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/items', () => {
  it('默认只返回 active；status=archived 只返回归档', async () => {
    const item = await createItem({ name: '归档测试品' });
    await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/archive`).send({ reason: 'used_up' });
    const active = await request(ctx.app.getHttpServer()).get('/api/items');
    expect(active.body.data.find((i: { id: number }) => i.id === item.id)).toBeUndefined();
    const archived = await request(ctx.app.getHttpServer()).get('/api/items?status=archived');
    expect(archived.body.data.find((i: { id: number }) => i.id === item.id)).toMatchObject({
      status: 'archived',
      archivedReason: 'used_up',
    });
  });

  it('q 模糊匹配名称（本文件共享同一 app，用唯一词避免数据污染）', async () => {
    await createItem({ name: '模糊匹_unique酸奶' });
    const res = await request(ctx.app.getHttpServer()).get('/api/items?q=模糊匹_unique');
    expect(res.body.data.map((i: { name: string }) => i.name)).toEqual(['模糊匹_unique酸奶']);
  });

  it('category 筛选', async () => {
    const cat = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '饮品' });
    await createItem({ name: '橙汁', categoryId: cat.body.data.id });
    await createItem({ name: '薯片' });
    const res = await request(ctx.app.getHttpServer()).get(`/api/items?category=${cat.body.data.id}`);
    expect(res.body.data.map((i: { name: string }) => i.name)).toEqual(['橙汁']);
  });

  it('空 q 返回 200 且为数组；无匹配词返回空数组（空输入边界）', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/items?q=');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const none = await request(ctx.app.getHttpServer()).get('/api/items?q=不存在的东西xyz');
    expect(none.body.data).toEqual([]);
  });
});

describe('PUT /api/items/:id', () => {
  it('name 更新：非法类型 → 400；前后空格 → 落库 trim 值（M1/M8）', async () => {
    const item = await createItem({ name: '更新名品' });
    const bad = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ name: null });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    const num = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ name: 456 });
    expect(num.status).toBe(400);
    const ok = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ name: '  面包  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.name).toBe('面包');
  });

  it('部分更新数量与刷新 updated_at', async () => {
    const item = await createItem({ name: '更新品', quantity: 5 });
    await new Promise((r) => setTimeout(r, 30));
    const res = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(2);
    expect(res.body.data.updatedAt >= item.updatedAt).toBe(true);
  });

  it('opened 置 1 → server 写 opened_at=当日；置 0 → 清空 opened_at', async () => {
    const item = await createItem({ name: '开封品', openShelfDays: 3 });
    const openRes = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ opened: 1 });
    expect(openRes.body.data.opened).toBe(1);
    expect(openRes.body.data.openedAt).toBeTruthy();
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(openRes.body.data.openedAt).toBe(todayISO);
    // 开封 + 开封保质天数 → 有效过期日 = opened_at + 3
    expect(openRes.body.data.effectiveExpiryDate).toBe(
      new Date(Date.parse(todayISO) + 3 * 86400000).toISOString().slice(0, 10),
    );
    const closeRes = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ opened: 0 });
    expect(closeRes.body.data.openedAt).toBeNull();
  });

  it('开封幂等：opened 置 1 且已开封时，不覆盖首次 opened_at（次日再开仍保留首次日期）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-10T10:00:00') });
    try {
      const item = await createItem({ name: '开封幂等品', openShelfDays: 3 });
      const first = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ opened: 1 });
      expect(first.body.data.openedAt).toBe('2026-01-10');
      // 时间推进到次日，重复开封
      vi.setSystemTime(new Date('2026-01-11T10:00:00'));
      const second = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ opened: 1 });
      expect(second.status).toBe(200);
      expect(second.body.data.openedAt).toBe('2026-01-10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opened 置 1 但无 open_shelf_days → 有效过期日回退 expiry_date', async () => {
    const item = await createItem({ name: '开封无保质', expiryDate: '2031-01-01' });
    const res = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ opened: 1 });
    expect(res.body.data.effectiveExpiryDate).toBe('2031-01-01');
  });

  it('不存在 → 404 ITEM_NOT_FOUND', async () => {
    const res = await request(ctx.app.getHttpServer()).put('/api/items/9999').send({ quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ITEM_NOT_FOUND');
  });

  it('非法负 quantity → 400', async () => {
    const item = await createItem({ name: '负数品' });
    const res = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ quantity: -5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/items/:id', () => {
  it('硬删除成功', async () => {
    const item = await createItem({ name: '待删品' });
    const res = await request(ctx.app.getHttpServer()).delete(`/api/items/${item.id}`);
    expect(res.status).toBe(200);
    const list = await request(ctx.app.getHttpServer()).get('/api/items?status=archived');
    expect(list.body.data.find((i: { id: number }) => i.id === item.id)).toBeUndefined();
  });

  it('不存在 → 404 ITEM_NOT_FOUND', async () => {
    const res = await request(ctx.app.getHttpServer()).delete('/api/items/9999');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ITEM_NOT_FOUND');
  });
});

describe('POST /api/items/:id/archive 与 restore', () => {
  it('归档 used_up：写 archived_reason/archived_at，从主列表消失', async () => {
    const item = await createItem({ name: '用完品' });
    const res = await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/archive`).send({ reason: 'used_up' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'archived', archivedReason: 'used_up' });
    expect(res.body.data.archivedAt).toBeTruthy();
  });

  it('归档 reason 非法 → 400 ARCHIVE_REASON_INVALID（非法枚举边界）', async () => {
    const item = await createItem({ name: '非法归档品' });
    for (const reason of ['thrown_away', '', null, 123]) {
      const res = await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/archive`).send({ reason });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ARCHIVE_REASON_INVALID');
    }
  });

  it('重复归档幂等：返回当前状态且不覆盖首次归档原因', async () => {
    const item = await createItem({ name: '重复归档品' });
    await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/archive`).send({ reason: 'expired_discarded' });
    const res = await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/archive`).send({ reason: 'used_up' });
    expect(res.status).toBe(200);
    expect(res.body.data.archivedReason).toBe('expired_discarded'); // 首次归档原因不被覆盖
  });

  it('restore：status→active，清空 archived_*', async () => {
    const item = await createItem({ name: '恢复品' });
    await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/archive`).send({ reason: 'used_up' });
    const res = await request(ctx.app.getHttpServer()).post(`/api/items/${item.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'active', archivedReason: null, archivedAt: null });
  });

  it('restore 不存在的物品 → 404', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/items/9999/restore');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ITEM_NOT_FOUND');
  });
});

describe('GET /api/items/history', () => {
  it('active+archived 名称模糊匹配，返回模板字段', async () => {
    await createItem({ name: '历史牛奶', unit: '盒', price: 12, expiryDate: '2030-06-01' });
    await request(ctx.app.getHttpServer())
      .post('/api/items')
      .send({ name: '历史牛奶', quantity: 1, unit: '盒', price: 12, expiryDate: '2030-06-01' })
      .then(async (r) => {
        await request(ctx.app.getHttpServer()).post(`/api/items/${r.body.data.id}/archive`).send({ reason: 'used_up' });
      });
    const res = await request(ctx.app.getHttpServer()).get('/api/items/history?q=历史牛奶');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    for (const h of res.body.data) {
      expect(h).toMatchObject({ name: '历史牛奶', unit: '盒', price: 12, expiryDate: '2030-06-01' });
      expect(h.quantity).toBeUndefined(); // 不含数量字段
    }
  });

  it('空 q 返回全部历史（边界）', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/items/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('临期状态阈值（remind_days 覆盖，default_remind_days=3 本任务 hardcode）', () => {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000);

  it('expiry_date=今天 → expired（与提醒判定统一：过期当天即过期）；+3 天 → expiring；+4 天 → ok', async () => {
    const cases: Array<[string, string]> = [
      [iso(today), 'expired'],
      [iso(addDays(today, 3)), 'expiring'],
      [iso(addDays(today, 4)), 'ok'],
    ];
    for (const [date, expected] of cases) {
      const item = await createItem({ name: `阈值-${expected}-${date}`, expiryDate: date });
      expect(item.expiryStatus).toBe(expected);
    }
  });

  it('expiry_date=昨天（当日>有效过期日）→ expired', async () => {
    const item = await createItem({ name: '阈值-expired', expiryDate: iso(addDays(today, -1)) });
    expect(item.expiryStatus).toBe('expired');
  });

  it('物品级 remindDays 覆盖：remindDays=7，+5 天 → expiring', async () => {
    const item = await createItem({ name: '覆盖阈值品', expiryDate: iso(addDays(today, 5)), remindDays: 7 });
    expect(item.expiryStatus).toBe('expiring');
  });

  it('已开封按开封保质期判定临期', async () => {
    const item = await createItem({ name: '开封临期品', expiryDate: '2030-01-01', openShelfDays: 2 });
    const res = await request(ctx.app.getHttpServer()).put(`/api/items/${item.id}`).send({ opened: 1 });
    // opened_at=今天，+2 天 → expiring
    expect(res.body.data.expiryStatus).toBe('expiring');
  });
});

describe('S-M2 minQuantity 校验（I-5 低库存链路的服务端防线）', () => {
  it('POST minQuantity 非法（负数/非数字）→ 400', async () => {
    const post = (body: Record<string, unknown>) =>
      request(ctx.app.getHttpServer()).post('/api/items').send(body);
    const r1 = await post({ name: '脏值牛奶', quantity: 1, minQuantity: -1 });
    expect(r1.status).toBe(400);
    const r2 = await post({ name: '脏值牛奶', quantity: 1, minQuantity: 'abc' });
    expect(r2.status).toBe(400);
    const r3 = await post({ name: '脏值牛奶', quantity: 1, minQuantity: 0 });
    expect(r3.status).toBe(201); // 0 合法（阈值可为 0）
  });

  it('PUT minQuantity 合法值可更新；null 可清除', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/api/items')
      .send({ name: '合法牛奶', quantity: 1, minQuantity: 2 });
    expect(created.status).toBe(201);
    const put = await request(ctx.app.getHttpServer())
      .put(`/api/items/${created.body.data.id}`)
      .send({ minQuantity: null });
    expect(put.status).toBe(200);
    expect(put.body.data.minQuantity).toBeNull();
  });
});
