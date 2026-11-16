/**
 * 文案一致性与布局杂修（评审 W-M4/W-M5/W-M6/W-M7/L-M3/L-M8/W-L17）：
 * - 渠道测试发送文案走 channelLabel 中文映射，不露开发代号
 * - 设置页与物品表单/详情同术语「提醒阈值」
 * - 通知行内归档按钮用动词前置（与归档弹层/归档页 chips 同词表）
 * - 清空已转换二次确认带后果说明；清单页有桌面宽度约束 wb-page
 * - 移动端组行不重复单位、无「最近 最早剩」叠词
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ default_remind_days: 3 })),
    updateSettings: vi.fn(async () => ({
      reminder_hour: 8,
      default_remind_days: 3,
      auto_archive_expired: 1,
      email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
      wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    })),
    notifyTest: vi.fn(async () => ({ results: { email: { ok: true } } })),
    listNotificationLogs: vi.fn(async () => []),
    listBackups: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
    clearConvertedShoppingItems: vi.fn(async () => {}),
    listNotifications: vi.fn(async () => []),
    markNotificationsDone: vi.fn(async () => {}),
    markNotificationsRead: vi.fn(async () => {}),
    undoNotificationsDone: vi.fn(async () => {}),
    archiveItem: vi.fn(async () => ({})),
  },
}));

import { api } from '../api';
import SettingsView from './SettingsView.vue';
import ShoppingView from './ShoppingView.vue';
import InventoryView from './InventoryView.vue';
import { router } from '../router';
import type { NotificationDto } from '@home-stock/shared';
import NotificationContent from '../components/NotificationContent.vue';

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '鲜牛奶',
    categoryId: null,
    quantity: 2,
    unit: '盒',
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

describe('设置页文案（W-M4/W-M7）', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
  });

  it('默认阈值字段用「提醒阈值」术语（与物品表单/详情一致）', async () => {
    const wrapper = mount(SettingsView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    const text = wrapper.find('#sec-remind').text();
    expect(text).toContain('全局默认提醒阈值');
    expect(text).not.toContain('提前天数');
  });

  it('测试发送结果用中文渠道名（不露 email/wecom 代号）', async () => {
    const wrapper = mount(SettingsView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    // 启用邮件渠道展开配置区，点测试发送
    const toggle = wrapper.find('#email-enabled');
    await toggle.setValue(1);
    const testBtn = wrapper.find('[data-channel="email"]');
    await testBtn.trigger('click');
    await flushPromises();
    const result = wrapper.text();
    expect(result).toContain('邮件渠道测试发送成功');
    expect(result).not.toContain('email 渠道');
  });
});

describe('通知行内归档动词前置（W-M5）', () => {
  it('按钮文案为「过期丢弃/用完」（与归档弹层/归档页 chips 同词表）', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      { id: 1, type: 'expiring_soon', itemId: 9, itemName: '酸奶', sentDate: '2026-11-16', read: 0, done: 0 },
      { id: 2, type: 'expired', itemId: 10, itemName: '面包', sentDate: '2026-11-16', read: 0, done: 0 },
    ] as NotificationDto[]);
    const wrapper = mount(NotificationContent);
    await flushPromises();
    const rows = wrapper.findAll('.notification-item');
    expect(rows[0].text()).toContain('用完');
    expect(rows[0].text()).not.toContain('已用完');
    expect(rows[1].text()).toContain('过期丢弃');
    expect(rows[1].text()).not.toContain('已过期丢弃');
  });
});

describe('清单页（W-M6/L-M3）', () => {
  it('根元素带 wb-page 桌面宽度约束', async () => {
    const wrapper = mount(ShoppingView);
    await flushPromises();
    expect(wrapper.find('.shopping').classes()).toContain('wb-page');
  });

  it('清空已转换二次确认带后果与不可恢复说明', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      { id: 5, name: '纸巾', quantity: 1, unit: null, price: null, categoryId: null, status: 'converted' },
    ]);
    const wrapper = mount(ShoppingView);
    await flushPromises();
    await wrapper.find('.clear-converted').trigger('click');
    expect((wrapper.find('.clear-converted').text())).toContain('不可恢复');
  });
});

describe('库存移动端组行文案（L-M8/W-L17）', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
  });

  it('合计不重复单位、无「最近」叠词', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({ id: 1, name: '鲜牛奶', quantity: 2, effectiveExpiryDate: '2026-11-20' }),
      makeItem({ id: 2, name: '鲜牛奶', quantity: 3, effectiveExpiryDate: '2026-11-25' }),
    ]);
    const wrapper = mount(InventoryView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    const group = wrapper.find('.item-group .item-meta');
    expect(group.text()).toContain('共 5 盒');
    expect(group.text()).not.toContain('盒 盒');
    expect(group.text()).not.toContain('最近');
  });
});
