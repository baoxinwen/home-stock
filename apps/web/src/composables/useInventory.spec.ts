/**
 * I-5 RED — 库存列表搜索/筛选响应竞态。
 * useInventory.load() 无序号守卫：慢的旧响应后到会覆盖新结果。
 * 预期：复用 StatsView 的 requestSeq 模式，只有最后一次请求的响应生效。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
  },
}));

import { api } from '../api';
import { useInventory } from './useInventory';

function makeItem(id: number, name: string): ItemDto {
  return {
    id,
    name,
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
  };
}

function mountHost(): { inv: ReturnType<typeof useInventory>; wrapper: ReturnType<typeof mount> } {
  let inv!: ReturnType<typeof useInventory>;
  const Host = defineComponent({
    setup() {
      inv = useInventory();
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { inv, wrapper };
}

describe('useInventory 请求竞态（I-5）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('两次请求乱序 resolve：最终 items 来自最后一次请求，慢响应被丢弃', async () => {
    let resolveSlow!: (v: ItemDto[]) => void;
    vi.mocked(api.listItems)
      .mockResolvedValueOnce([]) // onMounted 初始加载
      .mockImplementationOnce(() => new Promise<ItemDto[]>((r) => (resolveSlow = r))) // 第 1 次筛选：慢
      .mockResolvedValueOnce([makeItem(2, '新结果')]); // 第 2 次筛选：快
    const { inv } = mountHost();
    await flushPromises();

    inv.toggleCategory(1); // 慢请求发出
    await flushPromises();
    inv.toggleCategory(2); // 快请求发出
    await flushPromises();
    expect(inv.items.value.map((i) => i.name)).toEqual(['新结果']);

    resolveSlow([makeItem(1, '旧结果')]); // 慢响应后到
    await flushPromises();
    // 当前实现：旧响应覆盖新结果 → 必红；期望丢弃过期响应
    expect(inv.items.value.map((i) => i.name)).toEqual(['新结果']);
    expect(inv.loading.value).toBe(false);
    expect(inv.error.value).toBe('');
  });

  it('卸载后防抖定时器被清理，不再触发请求（M18）', async () => {
    vi.mocked(api.listItems).mockResolvedValue([]);
    const { inv, wrapper } = mountHost();
    await flushPromises(); // onMounted 初始 load 完成

    vi.useFakeTimers();
    try {
      inv.onSearchInput('牛'); // 300ms 后才会发请求
      wrapper.unmount(); // 卸载先于定时器触发
      await vi.advanceTimersByTimeAsync(300);
      vi.useRealTimers();
      // 当前实现：卸载不清理防抖定时器 → 会多发一次请求 → 必红
      expect(api.listItems).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
