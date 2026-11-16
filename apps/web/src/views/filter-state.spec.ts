/**
 * 筛选态程序化暴露与操作播报（评审 A-M3/A-M4/A-M7/A-M5/A-L6）：
 * - chips/模式切换激活态必须有 aria-pressed（4.1.2）
 * - 表头列名不得被 aria-hidden 移出无障碍树（1.3.1）
 * - 批次行可访问名称必须含可见文本（2.5.3 Label in Name）
 * - 操作结果有稳定 role=status 播报区（常驻渲染，空态无占位跳动）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => [{ id: 7, name: '乳品', sortOrder: null }]),
    getWasteStats: vi.fn(async () => ({ totalCount: 0, totalAmount: 0, byCategory: [] })),
    listNotifications: vi.fn(async () => []),
    markNotificationsDone: vi.fn(async () => {}),
    markNotificationsRead: vi.fn(async () => {}),
    listShoppingItems: vi.fn(async () => []),
    createShoppingItem: vi.fn(async () => ({})),
    getSettings: vi.fn(async () => ({ default_remind_days: 3 })),
    restoreItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    deleteItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    archiveItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    uploadImage: vi.fn(async () => {
      throw new Error('not implemented');
    }),
  },
}));

import { api } from '../api';
import InventoryView from './InventoryView.vue';
import ArchiveView from './ArchiveView.vue';
import ShoppingView from './ShoppingView.vue';
import NotificationContent from '../components/NotificationContent.vue';
import { router } from '../router';
import { formatDateCN } from '../lib/dates';

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '鲜牛奶',
    categoryId: 7,
    quantity: 2,
    unit: '盒',
    price: 12.9,
    purchaseDate: null,
    expiryDate: '2026-12-01',
    effectiveExpiryDate: '2026-12-01',
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
    expiryStatus: 'ok',
    ...patch,
  } as ItemDto;
}

function stubDesktop(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaQueryList);
}

describe('筛选激活态 aria-pressed（A-M3）', () => {
  beforeEach(() => {
    stubDesktop(false);
  });

  it('库存页类别 chips 带程序化激活态', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({})]);
    const wrapper = mount(InventoryView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    const chips = wrapper.findAll('.chips .chip');
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const chip of chips) {
      expect(chip.attributes('aria-pressed')).toBeDefined();
    }
    // 点选后激活态翻转
    expect(chips[1].attributes('aria-pressed')).toBe('false');
    await chips[1].trigger('click');
    expect(chips[1].attributes('aria-pressed')).toBe('true');
  });

  it('归档页原因 chips 带程序化激活态', async () => {
    const wrapper = mount(ArchiveView, { global: { stubs: { teleport: true } } });
    await flushPromises();
    const chips = wrapper.findAll('.chips .chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].attributes('aria-pressed')).toBe('true');
    expect(chips[2].attributes('aria-pressed')).toBe('false');
  });

  it('通知中心视图 chips 带程序化激活态', async () => {
    const wrapper = mount(NotificationContent);
    await flushPromises();
    const chips = wrapper.findAll('.chips .chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].attributes('aria-pressed')).toBe('true');
    await chips[2].trigger('click');
    expect(chips[2].attributes('aria-pressed')).toBe('true');
    expect(chips[0].attributes('aria-pressed')).toBe('false');
  });
});

describe('表头可访问性（A-M4）', () => {
  it('库存表头不再被 aria-hidden 移出无障碍树', async () => {
    stubDesktop(true);
    vi.mocked(api.listItems).mockResolvedValue([makeItem({})]);
    const wrapper = mount(InventoryView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    const thead = wrapper.find('.inv-thead');
    expect(thead.exists()).toBe(true);
    expect(thead.attributes('aria-hidden')).toBeUndefined();
    expect(thead.text()).toContain('物品');
  });

  it('归档表头不再被 aria-hidden 移出无障碍树', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({ status: 'archived', archivedReason: 'used_up', archivedAt: '2026-11-05T10:00:00.000Z' }),
    ]);
    const wrapper = mount(ArchiveView, { global: { stubs: { teleport: true } } });
    await flushPromises();
    const thead = wrapper.find('.arc-thead');
    expect(thead.attributes('aria-hidden')).toBeUndefined();
    expect(thead.text()).toContain('物品');
  });
});

describe('批次行 Label in Name（A-M7）', () => {
  it('桌面批次行可访问名称包含可见的日期文本', async () => {
    stubDesktop(true);
    const milk1 = makeItem({ id: 11, expiryDate: '2026-11-20', effectiveExpiryDate: '2026-11-20' });
    const milk2 = makeItem({ id: 12, expiryDate: '2026-12-20', effectiveExpiryDate: '2026-12-20' });
    vi.mocked(api.listItems).mockResolvedValue([milk1, milk2]);
    const wrapper = mount(InventoryView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    await wrapper.find('.inv-group-toggle').trigger('click');
    const batchBtn = wrapper.find('.inv-batch-row .inv-name-btn');
    expect(batchBtn.exists()).toBe(true);
    const label = batchBtn.attributes('aria-label') ?? '';
    const visibleDate = formatDateCN('2026-11-20');
    // 可见文本（日期）必须出现在可访问名称中
    expect(label).toContain(visibleDate);
  });
});

describe('操作结果稳定播报区（A-M5/A-L6）', () => {
  it('清单页 role=status 通知区常驻渲染（空时零占位）', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([]);
    const wrapper = mount(ShoppingView);
    await flushPromises();
    const status = wrapper.find('p[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toBe('');
  });

  it('通知内容组件的操作结果经 role=status 播报', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([]);
    const wrapper = mount(NotificationContent);
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });
});
