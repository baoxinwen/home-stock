/**
 * 归档页充实化测试：本月汇总条、原因筛选、搜索、筛选空态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
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

function makeArchived(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '草莓',
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
    status: 'archived',
    archivedReason: 'expired_discarded',
    archivedAt: '2026-11-05T10:00:00.000Z',
    createdAt: null,
    updatedAt: null,
    source: 'manual',
    effectiveExpiryDate: null,
    expiryStatus: 'expired',
    ...patch,
  };
}

const DATA = [
  makeArchived({ id: 1, name: '草莓', price: 19.9, archivedAt: '2026-11-05T10:00:00.000Z' }),
  makeArchived({ id: 2, name: '薯片', price: 7.5, archivedReason: 'used_up', archivedAt: '2026-10-06T10:00:00.000Z' }),
  makeArchived({ id: 3, name: '嫩豆腐', price: 4.5, archivedAt: '2026-11-01T10:00:00.000Z' }),
];

async function mountAt() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T12:00:00'));
  const wrapper = mount(ArchiveView);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.mocked(api.listItems).mockReset().mockResolvedValue(DATA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

import { afterEach } from 'vitest';

describe('ArchiveView 本月汇总', () => {
  it('本月归档 2 件、过期丢弃 2 件、浪费金额 ¥24.40', async () => {
    const wrapper = await mountAt();
    const cards = wrapper.findAll('.sum-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].text()).toContain('2');
    expect(cards[1].text()).toContain('2');
    expect(cards[2].text()).toContain('¥24.40'); // 19.9 + 4.5
  });
});

describe('ArchiveView 筛选与搜索', () => {
  it('原因筛选：过期丢弃只留本月+历史丢弃项', async () => {
    const wrapper = await mountAt();
    const chips = () => wrapper.findAll('.chip');
    await chips()[1].trigger('click'); // 过期丢弃
    const rows = wrapper.findAll('.archive-card');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('草莓');

    await chips()[2].trigger('click'); // 用完
    expect(wrapper.findAll('.archive-card')).toHaveLength(1);
    expect(wrapper.findAll('.archive-card')[0].text()).toContain('薯片');

    await chips()[0].trigger('click'); // 全部
    expect(wrapper.findAll('.archive-card')).toHaveLength(3);
  });

  it('名称搜索不区分大小写收窄列表；无结果给空文案', async () => {
    const wrapper = await mountAt();
    await wrapper.find('input[type="search"]').setValue('豆腐');
    expect(wrapper.findAll('.archive-card')).toHaveLength(1);

    await wrapper.find('input[type="search"]').setValue('不存在的物品');
    expect(wrapper.findAll('.archive-card')).toHaveLength(0);
    expect(wrapper.text()).toContain('没有符合筛选条件的归档记录');
  });

  it('归档卡片展示金额', async () => {
    const wrapper = await mountAt();
    expect(wrapper.findAll('.archive-card')[0].text()).toContain('¥19.90');
  });
});

describe('ArchiveView C-1 恢复链路（开封品顺延有效性）', () => {
  it('开封过期品点「顺延过期日 7 天并恢复」→ 清开封（opened=0）+ 本地口径顺延 7 天（W-M1）', async () => {
    // 开封品：openedAt 2026-10-20 + openShelfDays 7 → 有效过期日 10-27 已过（今天 11-07）
    const opened = makeArchived({
      id: 9,
      name: '开封酸奶',
      opened: 1,
      openedAt: '2026-10-20',
      openShelfDays: 7,
      effectiveExpiryDate: '2026-10-27',
    });
    vi.mocked(api.listItems).mockResolvedValue([opened]);
    vi.mocked(api.updateItem).mockResolvedValue({ ...opened, opened: 0, expiryDate: '2026-11-14' });
    vi.mocked(api.restoreItem).mockResolvedValue({ ...opened, opened: 0, status: 'active' });

    const wrapper = await mountAt();
    const card = wrapper.findAll('.archive-card').find((c) => c.text().includes('开封酸奶'))!;
    // overdue >= 1 → 弹面板
    await card.find('.btn-restore').trigger('click');
    await flushPromises();
    expect(wrapper.find('.rcp-panel[role=dialog]').exists()).toBe(true);

    // 选「顺延过期日 7 天并恢复」
    const postpone = [...wrapper.findAll('button')].find((b) => b.text().includes('顺延'));
    await postpone!.trigger('click');
    await flushPromises();

    // C-1 根因断言：必须清理开封状态，否则有效过期日仍按 openedAt+openShelfDays 计算为过去 → 次日再归档
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(api.updateItem).mock.calls[0][1] as { expiryDate: string; opened: number };
    expect(patch.opened).toBe(0);
    // W-M1：本地口径（系统时间 2026-11-07 + 7 = 11-14），而非 UTC 偏移日
    expect(patch.expiryDate).toBe('2026-11-14');
    expect(api.restoreItem).toHaveBeenCalledWith(9);
    // 完成后面板关闭
    expect(wrapper.find('.rcp-panel[role=dialog]').exists()).toBe(false);
  });

  it('仍恢复（force）不调用 updateItem，直接 restoreItem', async () => {
    const opened = makeArchived({ id: 9, name: '开封酸奶', opened: 1, openedAt: '2026-10-20', openShelfDays: 7, effectiveExpiryDate: '2026-10-27' });
    vi.mocked(api.listItems).mockResolvedValue([opened]);
    const wrapper = await mountAt();
    const card = wrapper.findAll('.archive-card').find((c) => c.text().includes('开封酸奶'))!;
    await card.find('.btn-restore').trigger('click');
    await flushPromises();
    const force = [...wrapper.findAll('button')].find((b) => b.text().includes('仍要恢复'));
    await force!.trigger('click');
    await flushPromises();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(api.restoreItem).toHaveBeenCalledWith(9);
  });
});
