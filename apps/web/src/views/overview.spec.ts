/**
 * 总览仪表盘测试：KPI 四卡、趋势/临期/明细/动态模块、空态与错误。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ItemDto, ShoppingItemDto, WasteStatsDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
    getWasteStats: vi.fn(async () => ({ period: '2026-11', totalCount: 0, totalAmount: 0, byCategory: [] })),
  },
}));

import { api } from '../api';
import OverviewView from './OverviewView.vue';

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
    imagePath: null,
    effectiveExpiryDate: null,
    expiryStatus: 'none',
    ...patch,
  };
}

function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: OverviewView },
      { path: '/items/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(OverviewView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
    query.status === 'archived' ? ([] as ItemDto[]) : ([] as ItemDto[]),
  );
  vi.mocked(api.listCategories).mockResolvedValue([
    { id: 1, name: '食品', sortOrder: null },
    { id: 2, name: '药品', sortOrder: null },
  ]);
  vi.mocked(api.listShoppingItems).mockResolvedValue([] as ShoppingItemDto[]);
  vi.mocked(api.getWasteStats).mockResolvedValue({
    period: '2026-11',
    totalCount: 6,
    totalAmount: 94.8,
    byCategory: [],
  } as WasteStatsDto);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OverviewView KPI', () => {
  it('四张 KPI：库存总价值/30 天到期/本月浪费(带上月)/待购清单(预计)', async () => {
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived'
        ? [
            // 上月浪费 ¥22.60、本月浪费走 getWasteStats
            makeItem({ id: 90, status: 'archived', archivedReason: 'expired_discarded', price: 22.6, quantity: 1, archivedAt: '2026-10-12T10:00:00.000Z' }),
          ]
        : [
            makeItem({ id: 1, categoryId: 1, quantity: 2, price: 12.9, effectiveExpiryDate: daysFromToday(2), expiryStatus: 'expiring' }),
            makeItem({ id: 2, categoryId: 2, quantity: 30, price: 0.9, effectiveExpiryDate: daysFromToday(40), expiryStatus: 'ok' }),
          ],
    );
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      { id: 1, name: '酱油', quantity: 1, unit: '瓶', price: 15.5, categoryId: null, status: 'pending' },
      { id: 2, name: '纸巾', quantity: 2, unit: null, price: 19.9, categoryId: null, status: 'pending' },
    ]);
    const { wrapper } = await mountView();

    const kpis = wrapper.findAll('.kpi-card');
    expect(kpis).toHaveLength(4);
    expect(kpis[0].text()).toContain('¥52.80'); // 12.9×2 + 0.9×30
    expect(kpis[0].text()).toContain('2 件在库');
    expect(kpis[1].text()).toContain('30 天内到期');
    expect(kpis[1].text()).toContain('1'); // 仅 +2 天那件
    expect(kpis[2].text()).toContain('¥94.80'); // getWasteStats
    expect(kpis[2].text()).toContain('6 件');
    expect(kpis[2].text()).toContain('上月 ¥22.60');
    expect(kpis[3].find('.kpi-value').text()).toContain('2'); // 模板块无空白，拆开断言
    expect(kpis[3].text()).toContain('¥55.30'); // 15.5 + 19.9×2
  });
});

describe('OverviewView 模块', () => {
  it('浪费趋势渲染 6 个月柱；临期列表升序且含今天到期', async () => {
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived'
        ? [makeItem({ id: 90, status: 'archived', archivedReason: 'expired_discarded', price: 20, quantity: 1, archivedAt: `${new Date().getFullYear()}-01-05T10:00:00.000Z` })]
        : [
            makeItem({ id: 1, name: '牛奶', effectiveExpiryDate: daysFromToday(0), expiryStatus: 'expiring' }),
            makeItem({ id: 2, name: '酸奶', effectiveExpiryDate: daysFromToday(5), expiryStatus: 'expiring' }),
            makeItem({ id: 3, name: '大米', effectiveExpiryDate: daysFromToday(60), expiryStatus: 'ok' }),
          ],
    );
    const { wrapper } = await mountView();

    expect(wrapper.findAll('.trend-col')).toHaveLength(6);
    const rows = wrapper.findAll('.expiring-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('牛奶');
    expect(rows[0].text()).toContain('今天到期');
    expect(rows[1].text()).toContain('剩 5 天');
  });

  it('库存明细按类别分组、组内临期优先、桌面行点击开抽屉（移动 href 保留）', async () => {
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived'
        ? []
        : [
            makeItem({ id: 1, name: '鸡蛋', categoryId: 1, effectiveExpiryDate: daysFromToday(20), expiryStatus: 'ok' }),
            makeItem({ id: 2, name: '面包', categoryId: 1, effectiveExpiryDate: daysFromToday(1), expiryStatus: 'expiring' }),
            makeItem({ id: 3, name: '布洛芬', categoryId: 2, expiryStatus: 'none', effectiveExpiryDate: null }),
          ],
    );
    const { wrapper } = await mountView();

    const groups = wrapper.findAll('.ov-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].find('.ov-group-name').text()).toBe('食品'); // 件数多在前
    const foodRows = groups[0].findAll('.ov-row');
    expect(foodRows.map((r) => r.find('.ov-name').text())).toEqual(['面包', '鸡蛋']); // 临期优先

    // 桌面：行点击开详情抽屉（不离开总览），href 仍指向详情页（中键/新标签可用）。
    // 抽屉 Teleport 到 body，需走 document 查询（wrapper 只覆盖组件树内）
    await foodRows[0].trigger('click');
    await flushPromises();
    const panel = document.querySelector('.drawer-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.item-name')?.textContent).toBe('面包');
    expect(foodRows[0].attributes('href')).toBe('/items/2');
    document.querySelector('.drawer-root')?.remove(); // 清理 teleported 节点
  });

  it('明细限前 8 条：跨组累计截断，尾部剩余提示指向库存页（2026-11-13 O-1）', async () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      makeItem({ id: i + 1, name: `物品${i + 1}`, categoryId: 1, effectiveExpiryDate: daysFromToday(30), expiryStatus: 'ok' }),
    );
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived' ? [] : many,
    );
    const { wrapper } = await mountView();

    const rows = wrapper.findAll('.ov-row');
    expect(rows).toHaveLength(8);
    expect(wrapper.find('.ov-more').text()).toContain('还有 3 件');
    expect(wrapper.find('.ov-more').attributes('href')).toBe('/inventory');
  });

  it('不足 8 件时不出现尾部剩余提示', async () => {
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived'
        ? []
        : [makeItem({ id: 1, name: '鸡蛋', categoryId: 1, effectiveExpiryDate: daysFromToday(20), expiryStatus: 'ok' })],
    );
    const { wrapper } = await mountView();
    expect(wrapper.findAll('.ov-row')).toHaveLength(1);
    expect(wrapper.find('.ov-more').exists()).toBe(false);
  });

  it('最近动态按时间倒序、带去向徽章与金额；类别价值分布渲染', async () => {
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived'
        ? [
            makeItem({ id: 91, name: '草莓', status: 'archived', archivedReason: 'expired_discarded', price: 19.9, quantity: 1, archivedAt: '2026-11-05T10:00:00.000Z' }),
            makeItem({ id: 92, name: '薯片', status: 'archived', archivedReason: 'used_up', price: 7.5, quantity: 1, archivedAt: '2026-11-06T10:00:00.000Z' }),
          ]
        : [makeItem({ id: 1, categoryId: 1, quantity: 1, price: 10 })],
    );
    const { wrapper } = await mountView();

    const feed = wrapper.findAll('.feed-item');
    expect(feed).toHaveLength(2);
    expect(feed[0].text()).toContain('薯片'); // 11-06 在前
    expect(feed[0].text()).toContain('用完');
    expect(feed[1].text()).toContain('过期丢弃');
    // 类别价值分布：2026-11-11 换环形图（图例行 + 中心总额）
    const legend = wrapper.findAll('.donut-legend li');
    expect(legend).toHaveLength(1);
    expect(legend[0].text()).toContain('食品 · 1 件');
    expect(legend[0].text()).toContain('¥10.00');
    expect(wrapper.find('.donut-hole').text()).toContain('¥10.00');
  });

  it('完全空库：库存明细给空文案，KPI 为零值', async () => {
    vi.mocked(api.getWasteStats).mockResolvedValue({
      period: '2026-11',
      totalCount: 0,
      totalAmount: 0,
      byCategory: [],
    });
    const { wrapper } = await mountView();
    expect(wrapper.text()).toContain('还没有物品');
    expect(wrapper.findAll('.ov-group')).toHaveLength(0);
    // D-17：无价格数据 → 总价值显示 — 而非误导性 ¥0.00
    expect(wrapper.find('.kpi-card').text()).toContain('—');
    expect(wrapper.find('.kpi-card').text()).not.toContain('¥');
    expect(wrapper.text()).toContain('暂无归档记录');
  });

  it('基础数据加载失败 → 错误文案，模块不渲染', async () => {
    vi.mocked(api.listItems).mockReset().mockRejectedValue(new Error('库存服务不可用'));
    const { wrapper } = await mountView();
    expect(wrapper.find('.error-text').text()).toContain('库存服务不可用');
    expect(wrapper.find('.kpi-row').exists()).toBe(false);
    expect(wrapper.find('.ov-group').exists()).toBe(false);
  });
});
