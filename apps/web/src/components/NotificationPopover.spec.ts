/**
 * NotificationPopover 单测（桌面通知轻量下拉）：
 * 面板只显示收件箱（未完成）的最近 8 条；全部完成（done 端点无 ids）；行点击跳详情并自动已读（A3）；
 * Esc/外部点击/路由变化关闭。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ItemDto, NotificationDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listNotifications: vi.fn(async () => []),
    listItems: vi.fn(async (query: { status?: string } = {}) =>
      query.status === 'archived' ? ([] as ItemDto[]) : ([] as ItemDto[]),
    ),
    markNotificationsRead: vi.fn(async () => ({ updated: 0 })),
    markNotificationsDone: vi.fn(async () => ({ updated: 0 })),
    listShoppingItems: vi.fn(async () => []),
  },
}));

import { api } from '../api';
import NotificationPopover from './NotificationPopover.vue';

function notif(patch: Partial<NotificationDto>): NotificationDto {
  return {
    id: 1,
    itemId: 11,
    itemName: null,
    type: 'expiring_soon',
    sentDate: '2026-11-08',
    channels: 'inapp',
    read: 0,
    done: 0,
    createdAt: null,
    ...patch,
  };
}

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 11,
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

function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/notifications', component: { template: '<div />' } },
      { path: '/items/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

async function mountPopover() {
  const router = await makeRouter();
  const wrapper = mount(NotificationPopover, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

beforeEach(() => {
  vi.mocked(api.listNotifications).mockResolvedValue([
    notif({ id: 1, itemId: 11, read: 0 }),
    notif({ id: 2, itemId: 22, itemName: '感冒灵颗粒', type: 'expired', read: 1 }),
    notif({ id: 3, itemId: 33, read: 0, done: 1 }), // 已完成 → 不出现在铃铛面板
  ]);
  vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
    query.status === 'archived'
      ? []
      : [makeItem({ effectiveExpiryDate: daysFromToday(2), expiryStatus: 'expiring' })],
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationPopover', () => {
  it('只显示收件箱（未完成）条目；未读数/行内容/底部全页链接', async () => {
    const { wrapper } = await mountPopover();
    expect(wrapper.find('.notif-pop-count').text()).toContain('未读 1');
    const rows = wrapper.findAll('.notif-pop-row');
    expect(rows).toHaveLength(2); // done=1 的第 3 条不出现
    expect(rows[0].text()).toContain('鲜牛奶');
    expect(rows[0].text()).toContain('剩 2 天');
    expect(rows[1].text()).toContain('感冒灵颗粒'); // itemName 快照（物品 22 不在列表）
    expect(rows[1].attributes('disabled')).toBeDefined(); // 物品不存在不可点
    expect(wrapper.find('.foot-link').attributes('href')).toBe('/notifications');
  });

  it('head「全部完成」调 done 端点（无 ids）并清空面板 + 刷新徽章', async () => {
    const { wrapper } = await mountPopover();
    await wrapper.find('.link-btn').trigger('click');
    await flushPromises();
    expect(api.markNotificationsDone).toHaveBeenCalledWith(); // 无 ids = 全部
    expect(api.markNotificationsRead).not.toHaveBeenCalled();
    expect(wrapper.findAll('.notif-pop-row')).toHaveLength(0);
    expect(api.listNotifications).toHaveBeenCalledWith(true); // refreshNavBadges 生效
    expect(wrapper.find('.link-btn').exists()).toBe(false);
  });

  it('行点击 → 跳物品详情全页 + A3 自动标已读 + 刷新徽章；emit close（路由变化）', async () => {
    const { wrapper, router } = await mountPopover();
    await wrapper.findAll('.notif-pop-row')[0].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/items/11');
    expect(api.markNotificationsRead).toHaveBeenCalledWith([1]); // A3
    expect(api.listNotifications).toHaveBeenCalledWith(true); // refreshNavBadges
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('已读行点击不再重复发已读请求', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 2, itemId: 11, read: 1 }),
    ]);
    const { wrapper } = await mountPopover();
    await wrapper.find('.notif-pop-row').trigger('click');
    await flushPromises();
    expect(api.markNotificationsRead).not.toHaveBeenCalled();
  });

  it('空收件箱区分「已全部处理 🎉」与「从没有通知」', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 9, itemId: null, read: 1, done: 1 }),
    ]);
    const { wrapper } = await mountPopover();
    expect(wrapper.find('.pop-hint').text()).toContain('已全部处理');

    vi.mocked(api.listNotifications).mockResolvedValue([]);
    const w2 = await mountPopover();
    expect(w2.wrapper.find('.pop-hint').text()).toContain('还没有提醒');
  });

  it('Esc 与外部点击 → emit close；面板内点击不关闭', async () => {
    const { wrapper } = await mountPopover();
    pressEscape();
    expect(wrapper.emitted('close')).toHaveLength(1);

    const { wrapper: w2 } = await mountPopover();
    document.body.click();
    expect(w2.emitted('close')).toHaveLength(1);

    const { wrapper: w3 } = await mountPopover();
    await w3.find('.notif-pop-head').trigger('click');
    expect(w3.emitted('close')).toBeUndefined();
  });

  it('路由变化 → emit close（查看全部通知跳转即收起）', async () => {
    const { wrapper, router } = await mountPopover();
    await router.push('/notifications');
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
