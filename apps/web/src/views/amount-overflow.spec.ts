/**
 * 金额卡溢出防护（评审 L-H1）：320px 窄卡下 nowrap 金额会溢出压邻卡
 * （运行时实测：归档 ¥1,234.56 溢 32px / 统计 ¥12,345.67 溢 14px）。
 * CSS 防护（overflow 三件套）无法在 happy-dom 断言，这里锁定可测的另一半：
 * 金额 span 必须绑定完整值 title（裁切时的完整值入口）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    getWasteStats: vi.fn(async () => ({ totalCount: 0, totalAmount: 0, byCategory: [] })),
    restoreItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
  },
}));

import { api } from '../api';
import ArchiveView from './ArchiveView.vue';
import StatsView from './StatsView.vue';
import InventoryView from './InventoryView.vue';

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '草莓',
    categoryId: null,
    purchaseDate: null,
    quantity: 2,
    unit: null,
    price: 19.9,
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
    expiryStatus: 'ok',
    ...patch,
  } as ItemDto;
}

async function titleOf(wrapper: ReturnType<typeof mount>, selector: string): Promise<string | undefined> {
  await flushPromises();
  return wrapper.find(selector).attributes('title');
}

describe('金额卡完整值入口（L-H1）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T12:00:00'));
    vi.mocked(api.listItems).mockResolvedValue([makeItem({})]);
    vi.mocked(api.listItems).mockResolvedValue([makeItem({})]);
  });

  it('归档汇总「本月浪费金额」带完整值 title', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({ status: 'archived', archivedReason: 'expired_discarded', archivedAt: '2026-11-05T10:00:00.000Z' }),
    ]);
    const wrapper = mount(ArchiveView);
    await flushPromises();
    // .sum-value 首个匹配是「本月归档」计数卡，取第三张（浪费金额）
    const money = wrapper.findAll('.sum-value')[2];
    expect(money.text()).toBe('¥39.80');
    expect(money.attributes('title')).toBe('¥39.80');
  });

  it('统计页两张金额卡（浪费金额/库存总价值）带完整值 title', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ price: 12.5 })]);
    const wrapper = mount(StatsView);
    await flushPromises();
    const monies = wrapper.findAll('.kpi-money');
    expect(monies.length).toBeGreaterThanOrEqual(2);
    // 浪费金额卡（stats.totalAmount=0 → ¥0.00）与库存总价值卡（12.5×2=25.00）
    expect(monies[0].attributes('title')).toBe('¥0.00');
    expect(monies[1].attributes('title')).toBe('¥25.00');
  });

  it('库存页静态「库存总价值」卡带完整值 title', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ price: 12.5 })]);
    const wrapper = mount(InventoryView);
    await flushPromises();
    const cards = wrapper.findAll('.ov-card').filter((c) => c.element.tagName === 'DIV');
    expect(cards).toHaveLength(1);
    const value = cards[0].find('.ov-value');
    expect(value.text()).toBe('¥25.00');
    expect(value.attributes('title')).toBe('¥25.00');
  });
});
