/**
 * 键盘焦点治理（评审 A-M2 余量 / A-L3）：
 * - 行移除类操作（通知行内完成、铃铛全部完成、清单勾选）后焦点落回相邻行/容器，
 *   不再丢到 body（此前每点一次焦点即从头重排）
 * - 提交按钮忙态用 aria-disabled 保留可聚焦（native disabled 使点击后焦点掉到 body）
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { NotificationDto, ShoppingItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    listNotifications: vi.fn(async () => []),
    markNotificationsDone: vi.fn(async () => {}),
    markNotificationsRead: vi.fn(async () => {}),
    undoNotificationsDone: vi.fn(async () => {}),
    archiveItem: vi.fn(async () => ({})),
    listShoppingItems: vi.fn(async () => []),
    updateShoppingItem: vi.fn(async () => ({})),
    updateItem: vi.fn(async () => ({})),
    restoreItem: vi.fn(async () => ({})),
  },
}));

import { api } from '../api';
import { router } from '../router';
import NotificationContent from '../components/NotificationContent.vue';
import NotificationPopover from '../components/NotificationPopover.vue';
import ShoppingView from './ShoppingView.vue';
import ArchiveView from './ArchiveView.vue';
import type { ItemDto } from '@home-stock/shared';

function notif(patch: Partial<NotificationDto>): NotificationDto {
  return {
    id: 1,
    type: 'expiring_soon',
    itemId: 9,
    itemName: '酸奶',
    sentDate: '2026-11-16',
    read: 0,
    done: 0,
    ...patch,
  } as NotificationDto;
}

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 9,
    name: '酸奶',
    categoryId: null,
    quantity: 1,
    unit: null,
    price: null,
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

function shopping(patch: Partial<ShoppingItemDto>): ShoppingItemDto {
  return {
    id: 1,
    name: '抽纸',
    quantity: 1,
    unit: null,
    price: null,
    categoryId: null,
    status: 'pending',
    ...patch,
  } as ShoppingItemDto;
}

describe('行移除后焦点还原（A-M2 余量）', () => {
  it('通知行点「完成」：焦点落到相邻行的主体按钮，不丢 body', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemName: '酸奶', itemId: 9 }),
      notif({ id: 2, itemName: '面包', itemId: 10 }),
    ]);
    // 行主体按钮的可聚焦依赖 canOpen（物品存在）
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({ id: 9, name: '酸奶' }),
      makeItem({ id: 10, name: '面包' }),
    ]);
    const wrapper = mount(NotificationContent, { attachTo: document.body });
    await flushPromises();
    const rows = wrapper.findAll('.notification-item');
    await rows[0].find('.notif-action.primary').trigger('click');
    await flushPromises();
    const active = document.activeElement as HTMLElement;
    expect(active.classList.contains('notif-main')).toBe(true);
    // 同位置相邻行（原第二行「面包」顶上来）
    expect(active.closest('.notification-item')?.textContent).toContain('面包');
    wrapper.unmount();
  });

  it('通知行全部完成（列表清空）：焦点落到弹层面板', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([notif({})]);
    const wrapper = mount(NotificationPopover, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    const all = [...wrapper.findAll('button')].find((b) => b.text() === '全部完成')!;
    await all.trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.find('.notif-pop').element);
    wrapper.unmount();
  });

  it('清单勾选完成（行移入折叠区）：焦点落到相邻待购行勾选钮', async () => {
    // 有状态 mock：勾选后重拉列表保持已勾选状态（模拟服务端真值）
    const db = [shopping({ id: 1, name: '抽纸' }), shopping({ id: 2, name: '垃圾袋' })];
    vi.mocked(api.listShoppingItems).mockImplementation(async () => [...db]);
    vi.mocked(api.updateShoppingItem).mockImplementation(async (id: number, patch: Partial<ShoppingItemDto>) => {
      const it = db.find((x) => x.id === id) as ShoppingItemDto;
      Object.assign(it, patch);
      return it;
    });
    const wrapper = mount(ShoppingView, { attachTo: document.body });
    await flushPromises();
    const toggles = wrapper.findAll('.pending-section .toggle');
    await toggles[0].trigger('click');
    await flushPromises();
    const active = document.activeElement as HTMLElement;
    expect(active.classList.contains('toggle')).toBe(true);
    // 相邻行（垃圾袋）的勾选钮
    expect(active.closest('.shopping-item')?.textContent).toContain('垃圾袋');
    wrapper.unmount();
  });
});

describe('归档过期品恢复后焦点不丢（评审 I-9）', () => {
  it('恢复完成列表重拉移除该行后，焦点落在稳定锚点而非 body', async () => {
    const archived = makeItem({
      id: 21,
      name: '过期酸奶',
      status: 'archived',
      expiryDate: '2020-01-01',
      effectiveExpiryDate: '2020-01-01',
      archivedReason: 'expired_discarded',
      archivedAt: '2026-11-10T08:00:00',
    });
    // 首次载入含该行；恢复后重拉为空（行被移除）
    vi.mocked(api.listItems).mockResolvedValueOnce([archived]).mockResolvedValueOnce([]);
    vi.mocked(api.updateItem).mockResolvedValue({ id: 21 } as ItemDto);
    vi.mocked(api.restoreItem).mockResolvedValue({ id: 21 } as ItemDto);

    const wrapper = mount(ArchiveView, {
      global: { plugins: [router], stubs: { teleport: true } },
      attachTo: document.body,
    });
    await flushPromises();

    const restoreBtn = wrapper.find('.btn-restore');
    expect(restoreBtn.exists()).toBe(true);
    (restoreBtn.element as HTMLElement).focus();
    await restoreBtn.trigger('click');
    await flushPromises();

    const option = wrapper.find('.rcp-option');
    expect(option.exists()).toBe(true);
    await option.trigger('click');
    await flushPromises();

    // 面板已关、行已随重拉移除：焦点必须仍落在文档内可见元素上（不落 body）
    expect(wrapper.find('.rcp-mask').exists()).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    wrapper.unmount();
  });
});
