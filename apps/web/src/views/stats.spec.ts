/**
 * 浪费统计（规格 M10.1/M10.2）+ 统计仪表盘前端测试：
 * 本月概览（件数+金额）、按类别分布、月份切换、空状态、
 * 库存总览 KPI、浪费趋势、临期提醒、浪费 vs 用完。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ItemDto, WasteStatsDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    getWasteStats: vi.fn(async () => stats()),
    listItems: vi.fn(async (query: { status?: string } = {}) =>
      query.status === 'archived' ? ([] as ItemDto[]) : ([] as ItemDto[]),
    ),
    listCategories: vi.fn(async () => []),
  },
}));

import { api } from '../api';
import StatsView from './StatsView.vue';

function stats(patch: Partial<WasteStatsDto> = {}): WasteStatsDto {
  return {
    period: '2026-02',
    totalCount: 0,
    totalAmount: 0,
    byCategory: [],
    ...patch,
  };
}

function makeItem(patch: Partial<ItemDto>): ItemDto {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 只冻结 Date（保留真实 setImmediate，让 flushPromises 能正常 flush）。 */
async function mountAt(dateISO = '2026-02-15T12:00:00') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(dateISO));
  const wrapper = mount(StatsView);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.mocked(api.getWasteStats).mockResolvedValue(stats());
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('StatsView 本月浪费概览（M10.1）', () => {
  it('展示当月件数与金额（金额两位小数、tabular-nums），默认查询当月', async () => {
    vi.mocked(api.getWasteStats).mockResolvedValue(
      stats({
        totalCount: 3,
        totalAmount: 30,
        byCategory: [{ categoryId: 1, categoryName: '食品', count: 3, amount: 30 }],
      }),
    );
    const wrapper = await mountAt();

    expect(api.getWasteStats).toHaveBeenCalledWith({ period: '2026-02' });
    expect(wrapper.find('.overview-count').text()).toContain('3');
    expect(wrapper.find('.overview-amount').text()).toContain('¥30.00');
    expect(wrapper.find('.overview-amount').classes()).toContain('num');
    expect(wrapper.find('.period-label').text()).toContain('2026年2月');
  });

  it('金额 12.5 → 12.50（等宽/表格数字对齐）', async () => {
    vi.mocked(api.getWasteStats).mockResolvedValue(stats({ totalCount: 1, totalAmount: 12.5 }));
    const wrapper = await mountAt();
    expect(wrapper.find('.overview-amount').text()).toContain('12.50');
  });
});

describe('StatsView 按类别分布（M10.2，并入当月浪费面板）', () => {
  it('渲染类别名、件数、金额与横向条，淡彩徽章按序着色', async () => {
    vi.mocked(api.getWasteStats).mockResolvedValue(
      stats({
        totalCount: 4,
        totalAmount: 34,
        byCategory: [
          { categoryId: 1, categoryName: '食品', count: 2, amount: 22 },
          { categoryId: null, categoryName: '未分类', count: 1, amount: 7 },
          { categoryId: 2, categoryName: '清洁', count: 1, amount: 5 },
        ],
      }),
    );
    const wrapper = await mountAt();

    const rows = wrapper.findAll('.category-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].text()).toContain('食品');
    expect(rows[0].text()).toContain('2 件');
    expect(rows[0].text()).toContain('¥22.00');
    expect(rows[1].text()).toContain('未分类');
    expect(rows[2].text()).toContain('清洁');

    const badges = wrapper.findAll('.cat-badge');
    expect(badges[0].classes()).toContain('tone-blue');
    expect(badges[1].classes()).toContain('tone-green');
    expect(badges[2].classes()).toContain('tone-yellow');

    const bars = wrapper.findAll('.bar-fill');
    expect(bars[0].attributes('style')).toContain('100%'); // 金额最高 → 满条
    expect(bars[1].attributes('style')).toMatch(/width:\s*\d/);
  });
  it('金额全为 0 时按件数归一，条形仍有可视化反馈', async () => {
    vi.mocked(api.getWasteStats).mockResolvedValue(
      stats({
        totalCount: 3,
        totalAmount: 0,
        byCategory: [
          { categoryId: 1, categoryName: '食品', count: 2, amount: 0 },
          { categoryId: 2, categoryName: '清洁', count: 1, amount: 0 },
        ],
      }),
    );
    const wrapper = await mountAt();
    const bars = wrapper.findAll('.bar-fill');
    expect(bars[0].attributes('style')).toContain('100%');
    expect(bars[1].attributes('style')).toContain('50%');
  });
});

describe('StatsView 月份切换', () => {
  it('上一月/下一月切换并重新查询；当月时「下一月」禁用', async () => {
    const wrapper = await mountAt('2026-02-15T12:00:00');
    expect(wrapper.find('.month-next').attributes('disabled')).toBeDefined();

    await wrapper.find('.month-prev').trigger('click');
    await flushPromises();
    expect(api.getWasteStats).toHaveBeenLastCalledWith({ period: '2026-01' });
    expect(wrapper.find('.period-label').text()).toContain('2026年1月');
    expect(wrapper.find('.month-next').attributes('disabled')).toBeUndefined();

    await wrapper.find('.month-next').trigger('click');
    await flushPromises();
    expect(api.getWasteStats).toHaveBeenLastCalledWith({ period: '2026-02' });
    expect(wrapper.find('.month-next').attributes('disabled')).toBeDefined();
  });

  it('跨年切换：2026-01 的上一月是 2025-12', async () => {
    const wrapper = await mountAt('2026-01-15T12:00:00');
    await wrapper.find('.month-prev').trigger('click');
    await flushPromises();
    expect(api.getWasteStats).toHaveBeenLastCalledWith({ period: '2025-12' });
    expect(wrapper.find('.period-label').text()).toContain('2025年12月');
  });

  it('快速切换月份时只采用最后一次请求的结果（旧响应不得覆盖新月份）', async () => {
    const initial = deferred<WasteStatsDto>();
    const prevMonth = deferred<WasteStatsDto>();
    vi.mocked(api.getWasteStats)
      .mockReset()
      .mockReturnValueOnce(initial.promise) // 当月 2026-02
      .mockReturnValueOnce(prevMonth.promise); // 上一月 2026-01

    const wrapper = await mountAt('2026-02-15T12:00:00');
    await wrapper.find('.month-prev').trigger('click');

    prevMonth.resolve(stats({ period: '2026-01', totalCount: 7, totalAmount: 7 }));
    await flushPromises();
    expect(wrapper.find('.overview-count').text()).toContain('7');

    // 先发出的「当月」请求后返回：不得覆盖已展示的上一月数据
    initial.resolve(stats({ period: '2026-02', totalCount: 99, totalAmount: 99 }));
    await flushPromises();
    expect(wrapper.find('.overview-count').text()).toContain('7');
    expect(wrapper.find('.period-label').text()).toContain('2026年1月');
  });
});

describe('StatsView 空状态与错误', () => {
  it('当月无浪费 → 「本月没有浪费，很好」，无类别列表', async () => {
    const wrapper = await mountAt();
    expect(wrapper.text()).toContain('本月没有浪费，很好');
    expect(wrapper.findAll('.category-row')).toHaveLength(0);
    expect(wrapper.find('.overview-count').text()).toContain('0');
    expect(wrapper.find('.overview-amount').text()).toContain('¥0.00');
  });

  it('非当月浏览时空状态用「该月」，当月仍用「本月」', async () => {
    const wrapper = await mountAt('2026-02-15T12:00:00');
    expect(wrapper.text()).toContain('本月没有浪费，很好');

    await wrapper.find('.month-prev').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('该月没有浪费，很好');
    expect(wrapper.text()).not.toContain('本月没有浪费');
  });

  it('加载失败 → 展示错误文案，不展示空状态', async () => {
    vi.mocked(api.getWasteStats).mockRejectedValue(new Error('统计服务不可用'));
    const wrapper = await mountAt();
    expect(wrapper.find('.error-text').text()).toContain('统计服务不可用');
    expect(wrapper.text()).not.toContain('本月没有浪费');
  });
});

// ---------- 统计仪表盘新增模块 ----------

/** 让 listItems 按查询参数区分在库/归档数据 */
function stubBase(active: ItemDto[], archived: ItemDto[]): void {
  vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
    query.status === 'archived' ? archived : active,
  );
}

describe('StatsView 库存总览 KPI', () => {
  it('展示在库件数与库存总价值（Σprice×quantity，客户端口径）', async () => {
    stubBase(
      [
        makeItem({ id: 1, quantity: 2, price: 12.9 }),
        makeItem({ id: 2, name: '鸡蛋', quantity: 30, price: 0.9 }),
        makeItem({ id: 3, name: '创可贴', quantity: 1, price: null }),
      ],
      [],
    );
    const wrapper = await mountAt();
    const kpis = wrapper.findAll('.kpi-card');
    expect(kpis).toHaveLength(5); // 2026-11-11 图表扩充：新增损耗率第 5 卡
    expect(kpis[2].text()).toContain('在库物品');
    expect(kpis[2].text()).toContain('3');
    expect(kpis[3].text()).toContain('库存总价值');
    expect(kpis[3].text()).toContain('¥52.80');
    expect(kpis[4].text()).toContain('损耗率');
  });
});

describe('StatsView 入库与浪费对比（2026-11-11 双柱合并）', () => {
  it('每月入库/浪费双柱共组，当月两柱高亮，浪费仅计过期丢弃', async () => {
    stubBase(
      [makeItem({ id: 8, purchaseDate: '2026-02-10', price: 50, quantity: 1 })],
      [
        makeItem({ id: 1, status: 'archived', archivedReason: 'expired_discarded', price: 20, quantity: 1, archivedAt: '2026-02-03T10:00:00.000Z' }),
        makeItem({ id: 2, status: 'archived', archivedReason: 'expired_discarded', price: 4.5, quantity: 1, archivedAt: '2026-02-05T10:00:00.000Z' }),
        makeItem({ id: 3, status: 'archived', archivedReason: 'used_up', price: 99, quantity: 1, archivedAt: '2026-01-06T10:00:00.000Z' }),
        makeItem({ id: 4, status: 'archived', archivedReason: 'expired_discarded', price: 10, quantity: 1, archivedAt: '2025-09-05T10:00:00.000Z' }),
      ],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    const chart = wrapper.find('.inout-chart');
    expect(chart.exists()).toBe(true);
    const groups = chart.findAll('.inout-group');
    expect(groups).toHaveLength(6);
    // 窗口：2025-09 ~ 2026-02；当月（2026-02）浪费 24.50（used_up 不计）、入库 50
    expect(groups[0].text()).toContain('9月');
    expect(groups[5].text()).toContain('¥24.50');
    expect(groups[5].text()).toContain('¥50.00');
    expect(groups[5].find('.bar-in-now').exists()).toBe(true);
    expect(groups[5].find('.bar-out-now').exists()).toBe(true);
    expect(chart.attributes('aria-label')).toContain('入库');
    // used_up 99 不计入浪费（2026-01 组浪费柱无金额标签）
    expect(groups[4].findAll('.inout-val-waste')).toHaveLength(0);
  });
});

describe('StatsView 临期提醒（未来 30 天）', () => {
  it('按剩余天数升序展示，含「今天到期」，超窗与无有效期不含', async () => {
    stubBase(
      [
        makeItem({ id: 1, name: '鲜牛奶', effectiveExpiryDate: '2026-02-15', expiryStatus: 'expiring' }),
        makeItem({ id: 2, name: '酸奶', quantity: 6, unit: '杯', effectiveExpiryDate: '2026-02-20', expiryStatus: 'expiring', opened: 1 }),
        makeItem({ id: 3, name: '大米', effectiveExpiryDate: '2026-03-20', expiryStatus: 'ok' }),
        makeItem({ id: 4, name: '创可贴', effectiveExpiryDate: null, expiryStatus: 'none' }),
      ],
      [],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    const rows = wrapper.findAll('.expiring-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('鲜牛奶');
    expect(rows[0].text()).toContain('今天到期');
    expect(rows[1].text()).toContain('剩 5 天');
    expect(rows[1].text()).toContain('已开封');
  });

  it('无临期 → 模块空文案', async () => {
    stubBase([makeItem({ id: 1, effectiveExpiryDate: null })], []);
    const wrapper = await mountAt();
    expect(wrapper.find('.expiring-list').exists()).toBe(false);
    expect(wrapper.text()).toContain('未来 30 天没有到期物品');
  });
});

describe('StatsView 浪费 vs 用完', () => {
  it('按月份拆分两段条与图例（件数 + 金额）', async () => {
    stubBase(
      [],
      [
        makeItem({ id: 1, archivedReason: 'expired_discarded', price: 8.5, quantity: 1, archivedAt: '2026-02-03T10:00:00.000Z' }),
        makeItem({ id: 2, archivedReason: 'expired_discarded', price: 19.9, quantity: 1, archivedAt: '2026-02-05T10:00:00.000Z' }),
        makeItem({ id: 3, archivedReason: 'used_up', price: 7.5, quantity: 1, archivedAt: '2026-02-06T10:00:00.000Z' }),
        makeItem({ id: 4, archivedReason: 'expired_discarded', price: 15.8, quantity: 1, archivedAt: '2026-01-12T10:00:00.000Z' }),
      ],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    const wasteSeg = wrapper.find('.usage-seg-waste');
    expect(wasteSeg.attributes('style')).toContain('67%');
    const legend = wrapper.find('.usage-legend').text();
    expect(legend).toContain('过期丢弃');
    expect(legend).toContain('2 件');
    expect(legend).toContain('¥28.40');
    expect(legend).toContain('用完');
    expect(legend).toContain('1 件');
    expect(legend).toContain('¥7.50');
  });

  it('该月无归档 → 合并面板空文案（本月/该月没有浪费）', async () => {
    stubBase([], []);
    const wrapper = await mountAt();
    expect(wrapper.text()).toContain('本月没有浪费，很好');
    expect(wrapper.text()).not.toContain('该月没有归档记录');
  });
});

describe('StatsView 基础数据失败', () => {
  it('listItems 失败 → 仪表盘模块区展示错误，不影响浪费概览', async () => {
    vi.mocked(api.listItems).mockReset().mockRejectedValue(new Error('库存服务不可用'));
    vi.mocked(api.getWasteStats).mockResolvedValue(
      stats({ totalCount: 1, totalAmount: 5, byCategory: [{ categoryId: 1, categoryName: '食品', count: 1, amount: 5 }] }),
    );
    const wrapper = await mountAt();
    expect(wrapper.text()).toContain('库存服务不可用');
    // 浪费概览不受影响
    expect(wrapper.find('.overview-count').text()).toContain('1');
    // 仪表盘模块（含当月浪费面板与类别细分）整体不渲染
    expect(wrapper.find('.module-grid').exists()).toBe(false);
    expect(wrapper.find('.category-row').exists()).toBe(false);
  });
});

// ---------- P0 扩充：入库节奏 / 库存健康 / KPI 环比 ----------

describe('StatsView 损耗率 KPI（2026-11-11 图表扩充）', () => {
  it('损耗率 = 选中月浪费金额 ÷ 同月入库金额；入库为 0 显示 —', async () => {
    stubBase(
      [makeItem({ id: 1, purchaseDate: '2026-02-03', price: 12.9, quantity: 2 })],
      [
        makeItem({ id: 9, status: 'archived', archivedReason: 'expired_discarded', price: 25.8, quantity: 1, archivedAt: '2026-02-08T10:00:00.000Z' }),
      ],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    // 2026-02：浪费 25.80 / 入库 25.80 → 100%
    const lossCard = wrapper.findAll('.kpi-card')[4];
    expect(lossCard.text()).toContain('100%');
    expect(lossCard.text()).toContain('当月浪费 ÷ 入库');
  });

  it('选中月无入库记录 → 损耗率显示 —', async () => {
    stubBase(
      [],
      [
        makeItem({ id: 9, status: 'archived', archivedReason: 'expired_discarded', price: 25.8, quantity: 1, archivedAt: '2026-02-08T10:00:00.000Z' }),
      ],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    expect(wrapper.findAll('.kpi-card')[4].text()).toContain('—');
  });
});

describe('StatsView 库存健康', () => {
  it('保质期堆叠条分段 + 状态环形中心件数；开封且临期计入临期', async () => {
    stubBase(
      [
        makeItem({ id: 1, effectiveExpiryDate: '2026-02-10', expiryStatus: 'expired' }),
        makeItem({ id: 2, effectiveExpiryDate: '2026-02-20', expiryStatus: 'expiring', opened: 1 }),
        makeItem({ id: 3, expiryStatus: 'none', opened: 1 }),
        makeItem({ id: 4, effectiveExpiryDate: '2026-06-01', expiryStatus: 'ok' }),
      ],
      [],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    const segs = wrapper.findAll('.fresh-seg');
    expect(segs.length).toBeGreaterThanOrEqual(3); // 过期/临期(d30)/90+ 三段非零
    const donut = wrapper.find('.status-donut');
    expect(donut.find('.donut-hole').text()).toContain('4');
    expect(donut.attributes('aria-label')).toContain('已过期 1 件');
    expect(wrapper.text()).toContain('开封且临期计入临期');
  });

  it('空库 → 空文案', async () => {
    stubBase([], []);
    const wrapper = await mountAt();
    expect(wrapper.text()).toContain('还没有在库物品');
  });
});

describe('StatsView KPI 环比', () => {
  it('浪费较上月下降 → 绿色 ↓；较上月上升 → 红色 ↑', async () => {
    stubBase(
      [],
      [
        makeItem({ id: 1, status: 'archived', archivedReason: 'expired_discarded', price: 10, quantity: 1, archivedAt: '2026-01-05T10:00:00.000Z' }),
        makeItem({ id: 2, status: 'archived', archivedReason: 'expired_discarded', price: 2.5, quantity: 1, archivedAt: '2026-02-05T10:00:00.000Z' }),
        makeItem({ id: 3, status: 'archived', archivedReason: 'expired_discarded', price: 2.5, quantity: 1, archivedAt: '2026-02-06T10:00:00.000Z' }),
      ],
    );
    const wrapper = await mountAt('2026-02-15T12:00:00');
    const deltas = wrapper.findAll('.kpi-delta');
    expect(deltas.length).toBe(2);
    // 件数：本月 2 件 vs 上月 1 件 → ↑100%（红）；金额：¥5 vs ¥10 → ↓50%（绿）
    expect(deltas[0].text()).toContain('↑ 100%');
    expect(deltas[0].classes()).toContain('delta-bad');
    expect(deltas[1].text()).toContain('↓ 50%');
    expect(deltas[1].classes()).toContain('delta-good');
  });

  it('两个月无浪费 → 持平文案', async () => {
    stubBase([], []);
    const wrapper = await mountAt();
    expect(wrapper.find('.kpi-delta').text()).toContain('与上月持平');
  });
});
