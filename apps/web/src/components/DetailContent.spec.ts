/**
 * DetailContent 恢复链路测试（I-4）：归档物品点「恢复」必须弹 D-9 同款
 * 去向面板（顺延 7 天 / 仍恢复），不再直通——与归档页同一语义。
 * 顺延执行需清开封（C-1：开封品有效过期日按 openedAt+openShelfDays 优先）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ default_remind_days: 3 })),
    listNotifications: vi.fn(async () => []),
    restoreItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    archiveItem: vi.fn(async () => ({})),
  },
}));

import { api } from '../api';
import DetailContent from './DetailContent.vue';

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 17,
    name: '感冒灵颗粒',
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

async function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/items/:id/edit', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

/** 挂载一个已归档且有效过期日已过 2 天的物品详情 */
async function mountArchived() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T12:00:00'));
  const router = await makeRouter();
  const wrapper = mount(DetailContent, {
    global: { plugins: [router] },
    props: { itemId: 17 },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.mocked(api.listItems).mockReset().mockImplementation(async (query: { status?: string } = {}) =>
    query.status === 'archived'
      ? [
          makeItem({
            status: 'archived',
            archivedReason: 'expired_discarded',
            archivedAt: '2026-11-05T10:00:00.000Z',
            effectiveExpiryDate: '2026-11-05',
            expiryStatus: 'expired',
          }),
        ]
      : [],
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('DetailContent I-4 恢复陷阱面板', () => {
  it('归档品点「恢复」→ 弹去向面板（不再直通 restoreItem）', async () => {
    const { wrapper } = await mountArchived();
    const restoreBtn = [...wrapper.findAll('button')].find((b) => b.text() === '恢复');
    expect(restoreBtn).toBeDefined();
    await restoreBtn!.trigger('click');
    await flushPromises();

    const panel = wrapper.find('.rcp-panel[role=dialog]');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('已过期 2 天');
    expect(api.restoreItem).not.toHaveBeenCalled();
  });

  it('面板选「顺延过期日 7 天并恢复」→ updateItem 清开封 + 本地口径顺延 + restoreItem', async () => {
    const { wrapper } = await mountArchived();
    await [...wrapper.findAll('button')].find((b) => b.text() === '恢复')!.trigger('click');
    await flushPromises();

    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ status: 'active', opened: 0, expiryDate: '2026-11-14' }));
    vi.mocked(api.restoreItem).mockResolvedValue(makeItem({ status: 'active', opened: 0 }));

    const postpone = [...wrapper.findAll('button')].find((b) => b.text().includes('顺延'));
    await postpone!.trigger('click');
    await flushPromises();

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(api.updateItem).mock.calls[0][1] as { expiryDate: string; opened: number };
    expect(patch.expiryDate).toBe('2026-11-14'); // 2026-11-07 + 7（本地口径）
    expect(patch.opened).toBe(0); // C-1：清开封让有效过期日回落
    expect(api.restoreItem).toHaveBeenCalledWith(17);
    expect(wrapper.find('.rcp-panel[role=dialog]').exists()).toBe(false);
  });

  it('面板取消 → 不执行任何恢复动作', async () => {
    const { wrapper } = await mountArchived();
    await [...wrapper.findAll('button')].find((b) => b.text() === '恢复')!.trigger('click');
    await flushPromises();
    const cancel = [...wrapper.findAll('button')].find((b) => b.text() === '取消');
    await cancel!.trigger('click');
    await flushPromises();
    expect(api.restoreItem).not.toHaveBeenCalled();
    expect(api.updateItem).not.toHaveBeenCalled();
  });
});

describe('DetailContent I-2 数量步进连点不丢更新', () => {
  function makeActive(patch: Partial<ItemDto> = {}): ItemDto {
    return makeItem({ status: 'active', name: '酸奶', quantity: 5, effectiveExpiryDate: '2026-11-09', expiryStatus: 'expiring', ...patch });
  }

  it('I-2 挂起中按钮禁用：连点不产生第二个并发 PUT、不丢不重', async () => {
    // 不用 fake Date：冻结 Date 会让 Vue 事件 _vts 去重吞掉同按钮第二次 click（环境怪癖）
    const active = makeActive();
    vi.mocked(api.listItems).mockResolvedValue([active]);

    let release!: (v: ItemDto) => void;
    const firstPut = new Promise<ItemDto>((r) => (release = r));
    const calls: Array<{ quantity: number }> = [];
    vi.mocked(api.updateItem).mockReset().mockImplementation(
      (_id: number, patch: { quantity?: number }) => {
        calls.push({ quantity: patch.quantity ?? 0 });
        if (calls.length === 1) return firstPut;
        return Promise.resolve({ ...active, quantity: patch.quantity ?? 0 });
      },
    );

    const router = await makeRouter();
    const wrapper = mount(DetailContent, { global: { plugins: [router] }, props: { itemId: active.id } });
    await flushPromises();

    const plus = wrapper.find('button[aria-label="增加数量"]');
    await plus.trigger('click'); // PUT(6) 挂起（await restore 缺 test 钩子——restoreItem 也要 mock）

    await flushPromises();
    // I-2：挂起中按钮 :disabled → disabled 元素不派发 click，第二次点击无效果（不丢不重）
    const plus2 = wrapper.find('button[aria-label="增加数量"]');
    expect(plus2.attributes('disabled')).toBeDefined();
    await plus2.trigger('click');
    await flushPromises();
    expect(calls).toHaveLength(1);

    release({ ...active, quantity: 6 } as ItemDto);
    await flushPromises();
    expect(calls).toHaveLength(1); // 第二次点击未产生请求
    expect(wrapper.find('.qty-value').text()).toContain('6'); // 最终值正确
  });
});
