/**
 * Task6 RED — 购物清单 API（M5.1/M5.2/M5.3）。
 * 覆盖：CRUD、勾选状态流转、status 过滤、convert 成功/重复/quantity<=0、
 * 清空 converted、五类边界（空输入/极值/非法类别/并发重复/依赖失败）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { ItemDto, ShoppingItemDto } from '@home-stock/shared';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let seq = 0;
const uid = (label: string) => `${label}_${Date.now()}_${++seq}`;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

const server = () => ctx.app.getHttpServer();

async function createShopping(body: Record<string, unknown>): Promise<ShoppingItemDto> {
  const res = await request(server()).post('/api/shopping-items').send(body);
  expect(res.status).toBe(201);
  return res.body.data as ShoppingItemDto;
}

async function createCategory(name: string): Promise<number> {
  const res = await request(server()).post('/api/categories').send({ name });
  expect(res.status).toBe(201);
  return res.body.data.id as number;
}

async function convert(id: number) {
  return request(server()).post(`/api/shopping-items/${id}/convert`);
}

/** 勾选完成（convert 只接受 done，M5.2） */
async function markDone(id: number): Promise<void> {
  const res = await request(server()).put(`/api/shopping-items/${id}`).send({ status: 'done' });
  expect(res.status).toBe(200);
}

async function itemsNamed(name: string): Promise<ItemDto[]> {
  const res = await request(server()).get('/api/items').query({ q: name });
  expect(res.status).toBe(200);
  return res.body.data as ItemDto[];
}

describe('POST /api/shopping-items', () => {
  it('最小创建：name 必填、quantity 默认 1、status=pending', async () => {
    const created = await createShopping({ name: uid('纸巾') });
    expect(created).toMatchObject({
      name: expect.stringContaining('纸巾'),
      quantity: 1,
      unit: null,
      price: null,
      categoryId: null,
      status: 'pending',
    });
    expect(created.id).toBeGreaterThan(0);
  });

  it('全字段创建（quantity/unit/price/categoryId）', async () => {
    const categoryId = await createCategory(uid('采购类别'));
    const name = uid('牛奶');
    const created = await createShopping({ name, quantity: 2, unit: '盒', price: 12, categoryId });
    expect(created).toMatchObject({ name, quantity: 2, unit: '盒', price: 12, categoryId, status: 'pending' });
  });

  it('空输入：name 缺失/空白/超长 → 400 VALIDATION_ERROR', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }]) {
      const res = await request(server()).post('/api/shopping-items').send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('极值：quantity=0 接受、负数拒绝、超大接受', async () => {
    const zero = await createShopping({ name: uid('零数量'), quantity: 0 });
    expect(zero.quantity).toBe(0);
    const neg = await request(server()).post('/api/shopping-items').send({ name: uid('负数'), quantity: -1 });
    expect(neg.status).toBe(400);
    expect(neg.body.code).toBe('VALIDATION_ERROR');
    const big = await createShopping({ name: uid('超大'), quantity: 999999999 });
    expect(big.quantity).toBe(999999999);
  });

  it('非法输入：price 为负 / category_id 不存在 → 400 VALIDATION_ERROR', async () => {
    const badPrice = await request(server())
      .post('/api/shopping-items')
      .send({ name: uid('负价'), price: -0.01 });
    expect(badPrice.status).toBe(400);
    expect(badPrice.body.code).toBe('VALIDATION_ERROR');

    const badCat = await request(server())
      .post('/api/shopping-items')
      .send({ name: uid('坏类别'), categoryId: 99999 });
    expect(badCat.status).toBe(400);
    expect(badCat.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/shopping-items', () => {
  it('缺省返回全部（含 converted），按创建时间倒序', async () => {
    const first = await createShopping({ name: uid('先创建') });
    const second = await createShopping({ name: uid('后创建') });
    const converted = await createShopping({ name: uid('已转换') });
    await markDone(converted.id);
    const item = await convert(converted.id);
    expect(item.status).toBe(200);

    const res = await request(server()).get('/api/shopping-items');
    expect(res.status).toBe(200);
    const ids = (res.body.data as ShoppingItemDto[]).map((s) => s.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    expect(ids).toContain(converted.id);
  });

  it('status 过滤 pending/done/converted；非法 status → 400', async () => {
    const pending = await createShopping({ name: uid('待购过滤') });
    const done = await createShopping({ name: uid('已完成过滤') });
    await request(server()).put(`/api/shopping-items/${done.id}`).send({ status: 'done' });
    const converted = await createShopping({ name: uid('转换过滤') });
    await markDone(converted.id);
    await convert(converted.id);

    const pendingList = (await request(server()).get('/api/shopping-items?status=pending')).body.data as ShoppingItemDto[];
    expect(pendingList.every((s) => s.status === 'pending')).toBe(true);
    expect(pendingList.map((s) => s.id)).toContain(pending.id);
    expect(pendingList.map((s) => s.id)).not.toContain(converted.id);

    const doneList = (await request(server()).get('/api/shopping-items?status=done')).body.data as ShoppingItemDto[];
    expect(doneList.every((s) => s.status === 'done')).toBe(true);
    expect(doneList.map((s) => s.id)).toContain(done.id);

    const convertedList = (await request(server()).get('/api/shopping-items?status=converted')).body.data as ShoppingItemDto[];
    expect(convertedList.every((s) => s.status === 'converted')).toBe(true);
    expect(convertedList.map((s) => s.id)).toContain(converted.id);

    // 空 status 视为缺省（与 items 接口一致）；非空非法值才 400
    const empty = await request(server()).get('/api/shopping-items?status=');
    expect(empty.status).toBe(200);
    expect(empty.body.data.length).toBeGreaterThan(0);
    for (const bogus of ['shopping', 'PENDING']) {
      const res = await request(server()).get(`/api/shopping-items?status=${bogus}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('PUT /api/shopping-items/:id', () => {
  it('部分更新数量/单位；勾选完成 done → 改回 pending', async () => {
    const shopping = await createShopping({ name: uid('勾选流转'), quantity: 1, unit: '包' });
    const done = await request(server())
      .put(`/api/shopping-items/${shopping.id}`)
      .send({ status: 'done', quantity: 2 });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ id: shopping.id, status: 'done', quantity: 2, unit: '包' });

    const back = await request(server()).put(`/api/shopping-items/${shopping.id}`).send({ status: 'pending' });
    expect(back.status).toBe(200);
    expect(back.body.data.status).toBe('pending');
  });

  it('空 body PUT → 200 原样返回（不产生坏 SQL）', async () => {
    const shopping = await createShopping({ name: uid('空更新') });
    const res = await request(server()).put(`/api/shopping-items/${shopping.id}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: shopping.id, name: shopping.name, status: 'pending' });
  });

  it('status=converted 不允许由 PUT 直接写入 → 400 VALIDATION_ERROR', async () => {
    const shopping = await createShopping({ name: uid('非法状态') });
    const res = await request(server())
      .put(`/api/shopping-items/${shopping.id}`)
      .send({ status: 'converted' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('已转换项不可再编辑 → 400 VALIDATION_ERROR', async () => {
    const shopping = await createShopping({ name: uid('转换后编辑') });
    await markDone(shopping.id);
    await convert(shopping.id);
    const res = await request(server()).put(`/api/shopping-items/${shopping.id}`).send({ quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('不存在 → 404 NOT_FOUND；非法 id → 400 VALIDATION_ERROR', async () => {
    const missing = await request(server()).put('/api/shopping-items/9999').send({ quantity: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    const bad = await request(server()).put('/api/shopping-items/abc').send({ quantity: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/shopping-items/:id', () => {
  it('删除成功且从列表消失；不存在 → 404 NOT_FOUND', async () => {
    const shopping = await createShopping({ name: uid('待删') });
    const res = await request(server()).delete(`/api/shopping-items/${shopping.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: shopping.id });
    const list = (await request(server()).get('/api/shopping-items')).body.data as ShoppingItemDto[];
    expect(list.map((s) => s.id)).not.toContain(shopping.id);

    const missing = await request(server()).delete('/api/shopping-items/9999');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/shopping-items/:id/convert（M5.2/M5.3）', () => {
  it('转库存成功：生成 active 物品（带入字段、无过期日），清单项 converted 且保留', async () => {
    const categoryId = await createCategory(uid('转库存类别'));
    const name = uid('转库存牛奶');
    const shopping = await createShopping({ name, quantity: 2, unit: '盒', price: 12, categoryId });
    await markDone(shopping.id);

    const res = await convert(shopping.id);
    expect(res.status).toBe(200);
    const result = res.body.data as { item: ItemDto; shoppingItem: ShoppingItemDto };
    expect(result.shoppingItem).toMatchObject({ id: shopping.id, status: 'converted' });
    expect(result.item).toMatchObject({
      name,
      quantity: 2,
      unit: '盒',
      price: 12,
      categoryId,
      status: 'active',
      expiryDate: null,
      effectiveExpiryDate: null,
      expiryStatus: 'none',
      source: 'shopping',
    });

    const inStock = await itemsNamed(name);
    expect(inStock).toHaveLength(1);
    expect(inStock[0].id).toBe(result.item.id);

    const convertedList = (await request(server()).get('/api/shopping-items?status=converted')).body.data as ShoppingItemDto[];
    expect(convertedList.map((s) => s.id)).toContain(shopping.id);
  });

  it('重复 convert → 409 ITEM_ALREADY_CONVERTED，且不重复生成库存', async () => {
    const name = uid('重复转换');
    const shopping = await createShopping({ name, quantity: 1 });
    await markDone(shopping.id);
    expect((await convert(shopping.id)).status).toBe(200);

    const again = await convert(shopping.id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ITEM_ALREADY_CONVERTED');
    expect(await itemsNamed(name)).toHaveLength(1);
  });

  it('类别在转库存前被删除 → 仍可转库存，类别降级为 null（不 500）', async () => {
    const categoryId = await createCategory(uid('待删类别'));
    const name = uid('类别消失');
    const shopping = await createShopping({ name, quantity: 1, categoryId });
    const del = await request(server()).delete(`/api/categories/${categoryId}`);
    expect(del.status).toBe(200);
    await markDone(shopping.id);

    const res = await convert(shopping.id);
    expect(res.status).toBe(200);
    expect(res.body.data.item.categoryId).toBeNull();
    expect(await itemsNamed(name)).toHaveLength(1);
  });

  it('quantity<=0 → 400 VALIDATION_ERROR，清单项仍为 done、不生成库存', async () => {
    const name = uid('零数量转换');
    const shopping = await createShopping({ name, quantity: 0 });
    await markDone(shopping.id);
    const res = await convert(shopping.id);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await itemsNamed(name)).toHaveLength(0);

    const row = (await request(server()).get('/api/shopping-items?status=done')).body.data as ShoppingItemDto[];
    expect(row.find((s) => s.id === shopping.id)?.status).toBe('done');

    // 负数走 DB 直改（API 已拒绝负数写入），convert 仍需兜底拒绝
    ctx.sqlite.prepare('UPDATE shopping_list_items SET quantity = -2 WHERE id = ?').run(shopping.id);
    const negative = await convert(shopping.id);
    expect(negative.status).toBe(400);
    expect(negative.body.code).toBe('VALIDATION_ERROR');
    expect(await itemsNamed(name)).toHaveLength(0);
  });

  it('pending 项可直接 convert（D-7：事务内先置 done），purchaseDate 记当天（D-5）', async () => {
    const name = uid('待购直接转换');
    const shopping = await createShopping({ name, quantity: 2 });
    const res = await convert(shopping.id);
    expect(res.status).toBe(200);
    expect(res.body.data.shoppingItem.status).toBe('converted');

    // D-5：转库存即「刚买到」，购买日期 = 当天
    const items = await itemsNamed(name);
    expect(items).toHaveLength(1);
    expect(items[0].purchaseDate).toBe(new Date().toISOString().slice(0, 10));

    const row = (await request(server()).get('/api/shopping-items?status=converted')).body.data as ShoppingItemDto[];
    expect(row.find((s) => s.id === shopping.id)?.status).toBe('converted');
  });

  it('并发重复 convert：只成功一次，另一次 ITEM_ALREADY_CONVERTED，库存仅 1 条', async () => {
    const name = uid('并发转换');
    const shopping = await createShopping({ name, quantity: 1 });
    await markDone(shopping.id);
    const [a, b] = await Promise.all([convert(shopping.id), convert(shopping.id)]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('ITEM_ALREADY_CONVERTED');
    expect(await itemsNamed(name)).toHaveLength(1);
  });

  it('M5.3：转库存物品无过期日 → 提醒扫描不产生通知', async () => {
    const name = uid('提醒扫描无过期');
    const shopping = await createShopping({ name, quantity: 1 });
    await markDone(shopping.id);
    const conv = await convert(shopping.id);
    expect(conv.status).toBe(200);
    const itemId = conv.body.data.item.id as number;

    const run = await request(server()).post('/api/reminders/run').send({});
    expect(run.status).toBe(200);
    expect(run.body.data.notified).toBe(0);

    const notifs = await request(server()).get('/api/notifications');
    expect(notifs.status).toBe(200);
    const forItem = (notifs.body.data as { itemId: number }[]).filter((n) => n.itemId === itemId);
    expect(forItem).toEqual([]);
  });

  it('convert 带 payload（表单确认）：物品完全按 payload 生成（含过期日/阈值字段），清单项 converted', async () => {
    const categoryId = await createCategory(uid('表单确认类别'));
    const shopping = await createShopping({ name: uid('表单确认前名'), quantity: 2, price: 12 });
    await markDone(shopping.id);

    const res = await request(server())
      .post(`/api/shopping-items/${shopping.id}/convert`)
      .send({
        name: '表单确认牛奶',
        categoryId,
        purchaseDate: '2026-11-13',
        quantity: 3,
        unit: '盒',
        price: 13.5,
        expiryDate: '2026-11-20',
        openShelfDays: 2,
        remindDays: 5,
        minQuantity: 1,
      });
    expect(res.status).toBe(200);
    const result = res.body.data as { item: ItemDto; shoppingItem: ShoppingItemDto };
    expect(result.shoppingItem).toMatchObject({ id: shopping.id, status: 'converted' });
    expect(result.item).toMatchObject({
      name: '表单确认牛奶',
      categoryId,
      purchaseDate: '2026-11-13',
      quantity: 3,
      unit: '盒',
      price: 13.5,
      expiryDate: '2026-11-20',
      openShelfDays: 2,
      remindDays: 5,
      minQuantity: 1,
      status: 'active',
      source: 'shopping',
    });
    expect(await itemsNamed('表单确认牛奶')).toHaveLength(1);
  });

  it('convert 带 payload 校验：name 空/quantity 非法 → 400，清单项保持 done 不生成库存', async () => {
    const shopping = await createShopping({ name: uid('payload校验'), quantity: 1 });
    await markDone(shopping.id);

    const badName = await request(server())
      .post(`/api/shopping-items/${shopping.id}/convert`)
      .send({ name: '   ', quantity: 1 });
    expect(badName.status).toBe(400);
    expect(badName.body.code).toBe('VALIDATION_ERROR');

    const badQty = await request(server())
      .post(`/api/shopping-items/${shopping.id}/convert`)
      .send({ name: uid('数量非法'), quantity: 0 });
    expect(badQty.status).toBe(400);
    expect(badQty.body.code).toBe('VALIDATION_ERROR');

    // name 提供时 trim 生效：空白两侧去掉
    const trimmed = await request(server())
      .post(`/api/shopping-items/${shopping.id}/convert`)
      .send({ name: `  ${uid('trim名单')}  `, quantity: 1 });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.data.item.name).not.toMatch(/^\s|\s$/);
  });
});

describe('DELETE /api/shopping-items/converted（M5.2 手动清空）', () => {
  it('只清空 converted，pending/done 保留', async () => {
    const converted = await createShopping({ name: uid('待清空转换') });
    await markDone(converted.id);
    await convert(converted.id);
    const pending = await createShopping({ name: uid('待清空pending') });
    const done = await createShopping({ name: uid('待清空done') });
    await request(server()).put(`/api/shopping-items/${done.id}`).send({ status: 'done' });

    const res = await request(server()).delete('/api/shopping-items/converted');
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBeGreaterThanOrEqual(1);

    const all = (await request(server()).get('/api/shopping-items')).body.data as ShoppingItemDto[];
    expect(all.map((s) => s.id)).not.toContain(converted.id);
    expect(all.map((s) => s.id)).toContain(pending.id);
    expect(all.map((s) => s.id)).toContain(done.id);
    expect(all.some((s) => s.status === 'converted')).toBe(false);
  });
});

describe('依赖失败与错误形状（规格第 9 节）', () => {
  it('db 抛错 → 500 INTERNAL_ERROR 统一形状', async () => {
    const res = await request(server()).get('/api/shopping-items').set('x-force-db-error', '1');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(typeof res.body.message).toBe('string');
  });
});
