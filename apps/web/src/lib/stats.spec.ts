/**
 * 统计仪表盘聚合纯函数单测（TDD RED）：
 * stockOverview / wasteTrend / expiringWithin / usageSplit。
 */
import { describe, expect, it } from 'vitest';
import type { ItemDto } from '@home-stock/shared';
import {
  expiringWithin,
  freshnessBuckets,
  monthOverMonth,
  purchaseTrend,
  stockOverview,
  stockStatusSplit,
  topValueItems,
  usageSplit,
  wasteTrend,
} from './stats';

function item(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '鲜牛奶',
    categoryId: null,
    purchaseDate: null,
    quantity: 1,
    unit: null,
    price: null,
    expiryDate: null,
    opened: 0,
    openedAt: null,
    openShelfDays: null,
    remindDays: null,
    minQuantity: null,
    status: 'active',
    archivedReason: null,
    archivedAt: null,
    createdAt: null,
    updatedAt: null,
    source: 'manual',
    effectiveExpiryDate: null,
    expiryStatus: 'none',
    ...patch,
  };
}

describe('stockOverview（库存总览）', () => {
  it('件数 = 条目数，价值 = Σ(price×quantity)，未填价格按 0', () => {
    const items = [
      item({ id: 1, quantity: 2, price: 12.9 }),
      item({ id: 2, quantity: 30, price: 0.9 }),
      item({ id: 3, quantity: 1, price: null }),
    ];
    const o = stockOverview(items);
    expect(o.count).toBe(3);
    expect(o.value).toBeCloseTo(52.8, 2);
  });

  it('按 categoryId 分桶（null 归「未分类」桶），按价值降序', () => {
    const items = [
      item({ id: 1, categoryId: 1, quantity: 2, price: 10 }),
      item({ id: 2, categoryId: 1, quantity: 1, price: 5 }),
      item({ id: 3, categoryId: null, quantity: 1, price: 30 }),
      item({ id: 4, categoryId: 2, quantity: 3, price: 2 }),
    ];
    const o = stockOverview(items);
    expect(o.byCategory.map((b) => [b.categoryId, b.count, b.value])).toEqual([
      [null, 1, 30],
      [1, 2, 25],
      [2, 1, 6],
    ]);
  });

  it('空列表返回零值', () => {
    expect(stockOverview([])).toEqual({ count: 0, value: 0, byCategory: [] });
  });
});

describe('wasteTrend（近 N 月浪费趋势，仅过期丢弃）', () => {
  const archivedAt = (iso: string) => iso;

  it('生成零值填充的连续月份桶，金额两位小数', () => {
    const archived = [
      item({ id: 1, status: 'archived', archivedReason: 'expired_discarded', price: 10, quantity: 2, archivedAt: archivedAt('2026-11-03T10:00:00.000Z') }),
      item({ id: 2, status: 'archived', archivedReason: 'expired_discarded', price: 4.5, quantity: 1, archivedAt: archivedAt('2026-11-05T10:00:00.000Z') }),
      item({ id: 3, status: 'archived', archivedReason: 'used_up', price: 99, quantity: 1, archivedAt: archivedAt('2026-10-01T10:00:00.000Z') }),
    ];
    const trend = wasteTrend(archived, 3, '2026-11');
    expect(trend.map((b) => b.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(trend[0]).toEqual({ month: '2026-09', count: 0, amount: 0 });
    expect(trend[1]).toEqual({ month: '2026-10', count: 0, amount: 0 });
    expect(trend[2]).toEqual({ month: '2026-11', count: 2, amount: 24.5 });
  });

  it('跨年窗口：截至 2026-01 的近 3 月含 2025-11', () => {
    const archived = [
      item({ id: 1, status: 'archived', archivedReason: 'expired_discarded', price: 8, quantity: 1, archivedAt: archivedAt('2025-11-20T10:00:00.000Z') }),
    ];
    const trend = wasteTrend(archived, 3, '2026-01');
    expect(trend.map((b) => b.month)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(trend[0].count).toBe(1);
    expect(trend[0].amount).toBe(8);
  });
});

describe('expiringWithin（未来 N 天到期）', () => {
  it('只留 0≤剩余天数≤窗口 的在库品，升序；无有效期/超窗/已过期不含', () => {
    const items = [
      item({ id: 1, effectiveExpiryDate: '2026-11-07', expiryStatus: 'expiring' }),
      item({ id: 2, effectiveExpiryDate: '2026-11-12', expiryStatus: 'expiring' }),
      item({ id: 3, effectiveExpiryDate: '2026-12-30', expiryStatus: 'ok' }),
      item({ id: 4, effectiveExpiryDate: '2026-11-01', expiryStatus: 'expired' }),
      item({ id: 5, effectiveExpiryDate: null, expiryStatus: 'none' }),
    ];
    const list = expiringWithin(items, '2026-11-07', 30);
    expect(list.map((e) => [e.item.id, e.daysLeft])).toEqual([
      [1, 0],
      [2, 5],
    ]);
  });

  it('到期当天 daysLeft = 0；窗口边界（第 30 天）包含', () => {
    const items = [
      item({ id: 1, effectiveExpiryDate: '2026-12-07' }),
      item({ id: 2, effectiveExpiryDate: '2026-12-08' }),
    ];
    const list = expiringWithin(items, '2026-11-07', 30);
    expect(list.map((e) => e.item.id)).toEqual([1]);
  });
});

describe('usageSplit（指定月份 浪费 vs 用完）', () => {
  it('按 archivedReason 分拆件数与金额，其他月份/原因忽略', () => {
    const archived = [
      item({ id: 1, archivedReason: 'expired_discarded', price: 8.5, quantity: 1, archivedAt: '2026-11-03T10:00:00.000Z' }),
      item({ id: 2, archivedReason: 'expired_discarded', price: 19.9, quantity: 1, archivedAt: '2026-11-05T10:00:00.000Z' }),
      item({ id: 3, archivedReason: 'used_up', price: 7.5, quantity: 1, archivedAt: '2026-11-06T10:00:00.000Z' }),
      item({ id: 4, archivedReason: 'expired_discarded', price: 15.8, quantity: 1, archivedAt: '2026-10-12T10:00:00.000Z' }),
      item({ id: 5, archivedReason: null, archivedAt: '2026-11-07T10:00:00.000Z' }),
    ];
    const s = usageSplit(archived, '2026-11');
    expect(s.wasted).toEqual({ count: 2, amount: 28.4 });
    expect(s.usedUp).toEqual({ count: 1, amount: 7.5 });
  });

  it('空月份返回零值', () => {
    const s = usageSplit([], '2026-11');
    expect(s.wasted).toEqual({ count: 0, amount: 0 });
    expect(s.usedUp).toEqual({ count: 0, amount: 0 });
  });
});

// ---------- 库存健康 / 入库节奏 / 环比（P0 扩充） ----------

describe('freshnessBuckets 保质期分桶', () => {
  it('六桶互斥全覆盖：过期/≤7/8-30/31-90/90+/未填日期', () => {
    const items = [
      item({ id: 1, effectiveExpiryDate: '2026-02-10', expiryStatus: 'expired' }), // 昨天 → 过期
      item({ id: 2, effectiveExpiryDate: '2026-02-15', expiryStatus: 'expiring' }), // 今天 → d7
      item({ id: 3, effectiveExpiryDate: '2026-02-22' }), // +7 → d7
      item({ id: 4, effectiveExpiryDate: '2026-03-10' }), // +23 → d30
      item({ id: 5, effectiveExpiryDate: '2026-05-10' }), // +84 → d90
      item({ id: 6, effectiveExpiryDate: '2026-08-01' }), // +167 → over90
      item({ id: 7 }), // 无日期 → undated
    ];
    const b = freshnessBuckets(items, '2026-02-15');
    expect(b).toEqual({ expired: 1, d7: 2, d30: 1, d90: 1, over90: 1, undated: 1 });
  });

  it('空列表全零', () => {
    expect(freshnessBuckets([], '2026-02-15')).toEqual({
      expired: 0, d7: 0, d30: 0, d90: 0, over90: 0, undated: 0,
    });
  });
});

describe('stockStatusSplit 状态四段（互斥）', () => {
  it('按紧急度归组：开封且临期计入临期，纯开封计入开封', () => {
    const items = [
      item({ id: 1, expiryStatus: 'expired' }),
      item({ id: 2, expiryStatus: 'expiring', opened: 1 }), // 开封且临期 → 临期
      item({ id: 3, expiryStatus: 'expiring' }),
      item({ id: 4, expiryStatus: 'none', opened: 1 }), // 已开封未临期 → 开封
      item({ id: 5, expiryStatus: 'none' }), // 正常
    ];
    expect(stockStatusSplit(items)).toEqual({ expired: 1, expiring: 2, opened: 1, ok: 1 });
  });
});

describe('purchaseTrend 入库节奏', () => {
  it('按 purchaseDate 分桶、零值填充、缺失日期不计、金额两位小数', () => {
    const items = [
      item({ id: 1, purchaseDate: '2025-12-20', price: 12.9, quantity: 2 }),
      item({ id: 2, purchaseDate: '2026-02-01', price: 3.335, quantity: 2 }), // 6.67
      item({ id: 3 }), // 未填购买日期 → 不计
      item({ id: 4, purchaseDate: '2024-01-01', price: 99 }), // 窗口外 → 不计
    ];
    const trend = purchaseTrend(items, 3, '2026-02');
    expect(trend.map((b) => b.month)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(trend[0]).toEqual({ month: '2025-12', count: 1, amount: 25.8 });
    expect(trend[1]).toEqual({ month: '2026-01', count: 0, amount: 0 });
    expect(trend[2]).toEqual({ month: '2026-02', count: 1, amount: 6.67 });
  });
});

describe('monthOverMonth 月度环比', () => {
  it('up/down/新增/持平四态', () => {
    expect(monthOverMonth(12, 8)).toEqual({ kind: 'up', percent: 50 });
    expect(monthOverMonth(4, 8)).toEqual({ kind: 'down', percent: -50 });
    expect(monthOverMonth(0, 8)).toEqual({ kind: 'down', percent: 100 });
    expect(monthOverMonth(5, 0)).toEqual({ kind: 'new', percent: null });
    expect(monthOverMonth(0, 0)).toEqual({ kind: 'flat', percent: null });
    expect(monthOverMonth(8, 8)).toEqual({ kind: 'flat', percent: 0 });
  });
});

describe('topValueItems 价值 Top 排行（统计页 P0 扩充）', () => {
  it('按 price×quantity 降序取前 limit，四舍五入两位', () => {
    const items = [
      item({ id: 1, name: '鸡蛋', quantity: 30, price: 25.8 }),
      item({ id: 2, name: '可乐', quantity: 6, price: 21 }),
      item({ id: 3, name: '挂面', quantity: 3, price: 6.5 }),
    ];
    const top = topValueItems(items, 2);
    expect(top).toHaveLength(2);
    expect(top[0].item.name).toBe('鸡蛋');
    expect(top[0].value).toBeCloseTo(774, 2);
    expect(top[1].item.name).toBe('可乐');
  });

  it('零价值（未填价格/数量 0）不入榜；不足 limit 时全部返回', () => {
    const items = [
      item({ id: 1, price: null, quantity: 5 }),
      item({ id: 2, quantity: 0, price: 10 }),
      item({ id: 3, quantity: 2, price: 3.3 }),
    ];
    const top = topValueItems(items, 8);
    expect(top).toHaveLength(1);
    expect(top[0].value).toBeCloseTo(6.6, 2);
  });
});
