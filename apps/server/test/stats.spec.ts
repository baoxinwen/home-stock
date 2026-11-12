/**
 * Task7 RED — 浪费统计（规格 M10.1/M10.2）后端契约。
 * 口径：仅 status=archived 且 archived_reason='expired_discarded'；
 *      used_up 不计入；未填价格只计件数；月份归属看 archived_at。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

beforeEach(() => {
  ctx.sqlite.exec('DELETE FROM items;');
  ctx.sqlite.exec('DELETE FROM categories;');
});

function localMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function insertCategory(name: string): number {
  const info = ctx.sqlite
    .prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
    .run(name, null);
  return Number(info.lastInsertRowid);
}

interface ArchivedSeed {
  name?: string;
  categoryId?: number | null;
  quantity?: number;
  price?: number | null;
  reason?: 'used_up' | 'expired_discarded';
  archivedAt?: string | null;
  updatedAt?: string;
}

/** 直接写库造归档数据（可精确控制 archived_at / updated_at，绕过 archive 接口的「现在」）。 */
function insertArchived(seed: ArchivedSeed = {}): number {
  const archivedAt = seed.archivedAt === undefined ? '2026-01-10T10:00:00' : seed.archivedAt;
  const info = ctx.sqlite
    .prepare(
      `INSERT INTO items
        (name, category_id, purchase_date, quantity, unit, price, expiry_date, opened,
         open_shelf_days, remind_days, min_quantity, status, archived_reason, archived_at,
         created_at, updated_at, source)
       VALUES (?, ?, NULL, ?, NULL, ?, NULL, 0, NULL, NULL, NULL, 'archived', ?, ?, ?, ?, 'manual')`,
    )
    .run(
      seed.name ?? '物品',
      seed.categoryId ?? null,
      seed.quantity ?? 1,
      seed.price === undefined ? null : seed.price,
      seed.reason ?? 'expired_discarded',
      archivedAt,
      '2026-01-01T00:00:00',
      seed.updatedAt ?? archivedAt ?? '2026-01-10T10:00:00',
    );
  return Number(info.lastInsertRowid);
}

function getWaste(query = '') {
  return request(ctx.app.getHttpServer()).get(`/api/stats/waste${query}`);
}

describe('GET /api/stats/waste — M10.1 浪费件数与金额', () => {
  it('仅统计 archived+expired_discarded：3 件过期丢弃共 30 元，5 条用完不计入', async () => {
    const cat = insertCategory('食品');
    insertArchived({ name: '酸奶', categoryId: cat, price: 10, archivedAt: '2026-01-03T09:00:00' });
    insertArchived({ name: '面包', categoryId: cat, price: 20, archivedAt: '2026-01-04T09:00:00' });
    insertArchived({
      name: '剩菜',
      categoryId: cat,
      quantity: 5,
      price: null,
      archivedAt: '2026-01-05T09:00:00',
    });
    for (let i = 0; i < 5; i++) {
      insertArchived({
        name: `用完${i}`,
        categoryId: cat,
        quantity: 2,
        price: 5,
        reason: 'used_up',
        archivedAt: '2026-01-06T09:00:00',
      });
    }
    insertArchived({ name: '二月丢弃', categoryId: cat, price: 99, archivedAt: '2026-02-02T09:00:00' });

    const res = await getWaste('?period=2026-01');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toEqual({
      period: '2026-01',
      totalCount: 3,
      totalAmount: 30,
      byCategory: [{ categoryId: cat, categoryName: '食品', count: 3, amount: 30 }],
    });
    // 未指定 groupBy 不返回 byMonth
    expect('byMonth' in data).toBe(false);
  });

  it('金额 = Σ(price×quantity)，浮点误差四舍五入到 2 位', async () => {
    insertArchived({ price: 0.1, quantity: 3 }); // 0.30000000000000004
    insertArchived({ price: 0.2, quantity: 1 }); // 0.2
    insertArchived({ price: 2.5, quantity: 3 }); // 7.5
    const res = await getWaste('?period=2026-01');
    expect(res.status).toBe(200);
    expect(res.body.data.totalAmount).toBe(8);
  });

  it('未填价格/数量为 0：只计件数，金额记 0', async () => {
    insertArchived({ price: null, quantity: 3 });
    insertArchived({ price: 10, quantity: 0 });
    const res = await getWaste('?period=2026-01');
    expect(res.body.data.totalCount).toBe(2);
    expect(res.body.data.totalAmount).toBe(0);
    expect(res.body.data.byCategory[0]).toMatchObject({ count: 2, amount: 0 });
  });
});

describe('GET /api/stats/waste — M10.2 按类别统计', () => {
  it('跨类别（含未分类）聚合，金额降序排列', async () => {
    const food = insertCategory('食品');
    const clean = insertCategory('清洁');
    insertArchived({ categoryId: food, price: 10, quantity: 1 });
    insertArchived({ categoryId: food, price: 3, quantity: 4 });
    insertArchived({ categoryId: clean, price: 2.5, quantity: 2 });
    insertArchived({ categoryId: null, price: 7, quantity: 1 });

    const res = await getWaste('?period=2026-01&groupBy=category');
    expect(res.status).toBe(200);
    expect(res.body.data.byCategory).toEqual([
      { categoryId: food, categoryName: '食品', count: 2, amount: 22 },
      { categoryId: null, categoryName: '未分类', count: 1, amount: 7 },
      { categoryId: clean, categoryName: '清洁', count: 1, amount: 5 },
    ]);
  });

  it('totalAmount = ΣbyCategory.amount（小数分桶舍入不丢分/不多分）', async () => {
    const a = insertCategory('A类');
    const b = insertCategory('B类');
    const c = insertCategory('C类');
    // 0.05×0.33 = 0.0165 → 分桶四舍五入 0.02；两个桶合计 0.04（旧实现总计 0.03，自相矛盾）
    insertArchived({ categoryId: a, price: 0.05, quantity: 0.33 });
    insertArchived({ categoryId: b, price: 0.05, quantity: 0.33 });
    // 1.005×0.33 = 0.33165 → 0.33
    insertArchived({ categoryId: c, price: 1.005, quantity: 0.33 });

    const res = await getWaste('?period=2026-01');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.byCategory).toEqual([
      { categoryId: c, categoryName: 'C类', count: 1, amount: 0.33 },
      { categoryId: a, categoryName: 'A类', count: 1, amount: 0.02 },
      { categoryId: b, categoryName: 'B类', count: 1, amount: 0.02 },
    ]);
    expect(data.totalAmount).toBe(0.37);
    // 严格按「分」核对：Σ 分桶 === 总计（浮点直接相加会有二进制表示噪声）
    const bucketCents = data.byCategory.reduce(
      (sum: number, x: { amount: number }) => sum + Math.round(x.amount * 100),
      0,
    );
    expect(bucketCents).toBe(Math.round(data.totalAmount * 100));
  });
});

describe('GET /api/stats/waste — 月份归属与边界', () => {
  it('月份归属看 archived_at 而不是 updated_at；archived_at 为空不计入任何月', async () => {
    insertArchived({
      name: '一月丢弃',
      price: 10,
      archivedAt: '2026-01-31T23:59:59',
      updatedAt: '2026-02-10T00:00:00',
    });
    insertArchived({
      name: '二月丢弃',
      price: 20,
      archivedAt: '2026-02-01T00:00:00',
      updatedAt: '2026-01-01T00:00:00',
    });
    insertArchived({
      name: '缺归档日',
      price: 30,
      archivedAt: null,
      updatedAt: '2026-01-15T00:00:00',
    });

    const jan = await getWaste('?period=2026-01');
    expect(jan.body.data.totalCount).toBe(1);
    expect(jan.body.data.totalAmount).toBe(10);

    const feb = await getWaste('?period=2026-02');
    expect(feb.body.data.totalCount).toBe(1);
    expect(feb.body.data.totalAmount).toBe(20);
  });

  it('空数据 → 零值而非 404（byCategory=[]）', async () => {
    const res = await getWaste('?period=2025-12');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      period: '2025-12',
      totalCount: 0,
      totalAmount: 0,
      byCategory: [],
    });
  });

  it('period 缺省 = 当月（本地时区），不返回其他月份数据', async () => {
    const month = localMonth();
    insertArchived({ name: '本月', price: 10, archivedAt: `${month}-05T12:00:00` });
    insertArchived({ name: '远古', price: 99, archivedAt: '2000-01-01T00:00:00' });

    const res = await getWaste();
    expect(res.status).toBe(200);
    expect(res.body.data.period).toBe(month);
    expect(res.body.data.totalCount).toBe(1);
    expect(res.body.data.totalAmount).toBe(10);
  });

  it('非法 period → 400 VALIDATION_ERROR', async () => {
    for (const p of ['2026-13', '2026-00', '2026-1', '2026-1a', 'abc', '2026-01-01']) {
      const res = await getWaste(`?period=${encodeURIComponent(p)}`);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('重复 period 查询参数 → 400 VALIDATION_ERROR（不做数组猜测）', async () => {
    const res = await getWaste('?period=2026-01&period=2026-02');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/stats/waste — groupBy', () => {
  it('groupBy=month 返回 byMonth（单月桶），默认 category 不返回', async () => {
    insertArchived({ price: 10 });
    insertArchived({ price: 20 });

    const cat = await getWaste('?period=2026-01');
    expect('byMonth' in cat.body.data).toBe(false);

    const monthly = await getWaste('?period=2026-01&groupBy=month');
    expect(monthly.status).toBe(200);
    expect(monthly.body.data.byMonth).toEqual([
      { month: '2026-01', count: 2, amount: 30 },
    ]);
    expect(monthly.body.data.byCategory).toHaveLength(1);
  });

  it('groupBy=month 且当月无浪费 → byMonth 零值桶（仍是 200）', async () => {
    const res = await getWaste('?period=2025-12&groupBy=month');
    expect(res.status).toBe(200);
    expect(res.body.data.byMonth).toEqual([{ month: '2025-12', count: 0, amount: 0 }]);
  });

  it('非法 groupBy → 400 VALIDATION_ERROR', async () => {
    const res = await getWaste('?period=2026-01&groupBy=xxx');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('GET /api/stats/waste — 极值与并发', () => {
  it('极值：超大金额 × 大数量 + 150 条记录，聚合不溢出', async () => {
    insertArchived({ name: '天价', price: 99999999.99, quantity: 999999 });
    const seedMany = ctx.sqlite.transaction(() => {
      for (let i = 0; i < 150; i++) insertArchived({ name: `批量${i}`, price: 1, quantity: 2 });
    });
    seedMany();

    const res = await getWaste('?period=2026-01');
    expect(res.status).toBe(200);
    expect(res.body.data.totalCount).toBe(151);
    expect(res.body.data.totalAmount).toBe(99999899990000 + 300);
  });

  it('同月重复/并发查询结果稳定且无副作用', async () => {
    insertArchived({ price: 10 });
    insertArchived({ price: 20 });
    insertArchived({ price: null });

    const results = await Promise.all(Array.from({ length: 8 }, () => getWaste('?period=2026-01')));
    const bodies = results.map((r) => r.body.data);
    expect(bodies[0]).toMatchObject({ totalCount: 3, totalAmount: 30 });
    for (const b of bodies) expect(b).toEqual(bodies[0]);

    const count = ctx.sqlite.prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number };
    expect(count.c).toBe(3);
  });
});

describe('GET /api/stats/waste — 依赖失败', () => {
  it('db 抛错 → 统一 500 { code: INTERNAL_ERROR, message }', async () => {
    const broken = await startTestApp();
    try {
      broken.sqlite.exec('DROP TABLE items');
      const res = await request(broken.app.getHttpServer()).get('/api/stats/waste?period=2026-01');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String) });
    } finally {
      await stopTestApp(broken);
    }
  });
});
