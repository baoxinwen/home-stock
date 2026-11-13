/**
 * 通知中心测试（三态收件箱，对标 GitHub inbox unread→read→done）：
 * 收件箱/未读/已完成 chips、分组（今天/更早）、行内完成✓/已用完/恢复、
 * 点行自动已读（A3）、全部完成（B3）、双空态（B2）、相对时间（B1）、
 * 首字头像（R1）、主操作分级（R2）、已完成去警示（R3）、发送日志折叠。
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
    listNotificationLogs: vi.fn(async () => []),
    markNotificationsRead: vi.fn(async () => ({ updated: 0 })),
    markNotificationsDone: vi.fn(async () => ({ updated: 0 })),
    undoNotificationsDone: vi.fn(async () => ({ updated: 0 })),
    archiveItem: vi.fn(async () => ({})),
    listShoppingItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ default_remind_days: 3 })),
  },
}));

import { api } from '../api';
import { todayISO } from '../lib/dates';
import NotifCenterView from './NotifCenterView.vue';

function notif(patch: Partial<NotificationDto>): NotificationDto {
  return {
    id: 1,
    itemId: 1,
    itemName: null,
    type: 'expiring_soon',
    sentDate: '2026-11-07',
    channels: 'inapp',
    read: 0,
    done: 0,
    createdAt: null,
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

async function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/items/:id', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

async function mountView() {
  const router = await makeRouter();
  const wrapper = mount(NotifCenterView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.mocked(api.listNotifications).mockResolvedValue([]);
  vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
    query.status === 'archived' ? [] : [],
  );
  vi.mocked(api.listNotificationLogs).mockResolvedValue([]);
});

afterEach(() => {
  document.body.querySelectorAll('.drawer-root').forEach((el) => el.remove());
  vi.clearAllMocks();
});

describe('NotifCenterView 物品名与行点击', () => {
  it('join 在库+归档物品名；桌面点击行弹物品抽屉 + A3 自动已读；itemId 为空不可点', async () => {
    // happy-dom 默认宽 1024 → 桌面分支（右侧抽屉）
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 11, type: 'expired', sentDate: todayISO(), read: 0 }),
      notif({ id: 2, itemId: 22, sentDate: '2026-11-06', read: 1 }),
      notif({ id: 3, itemId: null, sentDate: '2026-11-06', read: 1 }),
    ]);
    vi.mocked(api.listItems).mockReset().mockImplementation(async (query = {}) =>
      query.status === 'archived'
        ? [makeItem({ id: 22, name: '阿莫西林胶囊', status: 'archived' })]
        : [makeItem({ id: 11, name: '鲜牛奶' })],
    );
    const { wrapper, router } = await mountView();

    const mains = wrapper.findAll('.notif-main');
    expect(mains).toHaveLength(3);
    expect(mains[0].text()).toContain('鲜牛奶');
    expect(mains[1].text()).toContain('阿莫西林胶囊');
    expect(mains[2].text()).toContain('—');
    expect(mains[2].attributes('disabled')).toBeDefined();

    // 桌面：行点击开物品抽屉（Teleport body），不跳页
    await mains[0].trigger('click');
    await flushPromises();
    const panel = document.querySelector('.drawer-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.item-name')?.textContent).toContain('鲜牛奶');
    expect(router.currentRoute.value.fullPath).toBe('/');
    // A3：点行即已读（fire-and-forget）
    expect(api.markNotificationsRead).toHaveBeenCalledWith([1]);
    document.querySelector('.drawer-root')?.remove();
  });

  it('移动窄屏点击行 → 跳详情全页', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 11, sentDate: todayISO(), read: 0 }),
    ]);
    vi.mocked(api.listItems).mockReset().mockImplementation(async () => [
      makeItem({ id: 11, name: '鲜牛奶' }),
    ]);
    const { wrapper, router } = await mountView();
    await wrapper.findAll('.notif-main')[0].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/items/11');
    expect(document.querySelector('.drawer-panel')).toBeNull();
    vi.restoreAllMocks();
  });

  it('物品已删除的 itemId → 展示占位且不可跳转', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 999, sentDate: '2026-11-07', read: 1 }),
    ]);
    const { wrapper } = await mountView();
    const main = wrapper.find('.notif-main');
    expect(main.text()).toContain('（物品已删除）');
    expect(main.attributes('disabled')).toBeDefined();
  });
});

describe('NotifCenterView 收件箱三态', () => {
  const today = todayISO();
  const earlier = '2020-01-01';
  const data = [
    notif({ id: 1, itemId: 1, sentDate: today, read: 0 }), // 收件箱·未读
    notif({ id: 2, itemId: 1, sentDate: today, read: 1 }), // 收件箱·已读
    notif({ id: 3, itemId: 1, sentDate: earlier, read: 1, done: 1 }), // 已完成
  ];

  it('chips 计数（收件箱/未读/已完成）与默认收件箱视图', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue(data);
    const { wrapper } = await mountView();
    const chips = wrapper.findAll('.chip');
    expect(chips.map((c) => c.text().replace(/\s/g, ''))).toEqual(['收件箱2', '未读1', '已完成1']);
    // 默认收件箱：done 的第 3 条不出现
    expect(wrapper.findAll('.notification-item')).toHaveLength(2);
  });

  it('收件箱按「今天/更早」分组', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 1, sentDate: today, read: 0 }),
      notif({ id: 2, itemId: 1, sentDate: earlier, read: 1 }),
      notif({ id: 3, itemId: 1, sentDate: earlier, read: 1, done: 1 }),
    ]);
    const { wrapper } = await mountView();
    const groups = wrapper.findAll('.notif-group');
    expect(groups.map((g) => g.find('.group-title').text())).toEqual(['今天', '更早']);
    expect(groups[0].findAll('.notification-item')).toHaveLength(1);
    expect(groups[1].findAll('.notification-item')).toHaveLength(1); // done 的不分到收件箱
  });

  it('未读筛选只看收件箱未读；已完成视图平铺 + 恢复', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue(data);
    const { wrapper } = await mountView();
    const chips = wrapper.findAll('.chip');

    await chips[1].trigger('click'); // 未读
    await flushPromises();
    expect(wrapper.findAll('.notification-item')).toHaveLength(1);

    await chips[2].trigger('click'); // 已完成
    await flushPromises();
    const doneRows = wrapper.findAll('.notification-item');
    expect(doneRows).toHaveLength(1);
    expect(doneRows[0].text()).toContain('恢复');

    await doneRows[0].find('.notif-action').trigger('click'); // 恢复
    await flushPromises();
    expect(api.undoNotificationsDone).toHaveBeenCalledWith([3]);
    // 恢复后本地状态回收件箱：已完成视图清空
    expect(wrapper.findAll('.notification-item')).toHaveLength(0);
  });

  it('行内「完成 ✓」调 done 端点并移出收件箱；「全部完成」调用无 ids 版本', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 1, sentDate: today, read: 0 }),
      notif({ id: 2, itemId: 1, sentDate: today, read: 0 }),
    ]);
    const { wrapper } = await mountView();
    expect(wrapper.findAll('.notification-item')).toHaveLength(2);

    // 单条完成（按钮文本「完成 ✓」）
    const actions = wrapper.findAll('.notification-item')[0].findAll('.notif-action');
    await actions.find((b) => b.text() === '完成 ✓')!.trigger('click');
    await flushPromises();
    expect(api.markNotificationsDone).toHaveBeenCalledWith([1]);
    expect(wrapper.findAll('.notification-item')).toHaveLength(1);

    // 全部完成（无 ids = 全部）
    await wrapper.find('.mark-all').trigger('click');
    await flushPromises();
    expect(api.markNotificationsDone).toHaveBeenCalledWith();
    expect(wrapper.findAll('.notification-item')).toHaveLength(0);
    // 徽章刷新被宿主触发（onReadChanged → refreshNavBadges）
    expect(api.listNotifications).toHaveBeenCalledWith(true);
  });

  it('I-6 行内快捷归档按通知类型分流：临期→已用完（used_up）；过期→已过期丢弃（expired_discarded 计浪费）', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 11, sentDate: today, read: 0 }), // 临期 → used_up
      notif({ id: 2, itemId: 12, type: 'expired', itemName: '感冒灵颗粒', sentDate: today, read: 0 }), // 过期 → expired_discarded
    ]);
    vi.mocked(api.listItems).mockReset().mockImplementation(async () => [
      makeItem({ id: 11, name: '鲜牛奶' }),
      makeItem({ id: 12, name: '感冒灵颗粒' }),
    ]);
    const { wrapper } = await mountView();
    const rows = wrapper.findAll('.notification-item');

    const usedUp = rows[0].findAll('.notif-action').find((b) => b.text() === '已用完')!;
    await usedUp.trigger('click');
    await flushPromises();
    expect(api.archiveItem).toHaveBeenCalledWith(11, { reason: 'used_up' });
    expect(api.markNotificationsDone).toHaveBeenCalledWith([1]);

    const discard = rows[1].findAll('.notif-action').find((b) => b.text() === '已过期丢弃')!;
    expect(discard).toBeDefined(); // 过期通知不再误显「已用完」
    await discard.trigger('click');
    await flushPromises();
    expect(api.archiveItem).toHaveBeenCalledWith(12, { reason: 'expired_discarded' });
    expect(api.markNotificationsDone).toHaveBeenCalledWith([2]);
    expect(wrapper.findAll('.notification-item')).toHaveLength(0);
  });

  it('B2 双空态：无通知 vs 收件箱已清空', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([]);
    const { wrapper } = await mountView();
    expect(wrapper.text()).toContain('还没有提醒');

    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: null, read: 1, done: 1 }),
    ]);
    const w2 = await mountView();
    expect(w2.wrapper.text()).toContain('已全部处理');
  });

  it('B1 相对时间：今天→「今天」，更早→「N 天前」/「跨年带年份」', async () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    const threeDaysAgo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 1, sentDate: today, read: 0 }),
      notif({ id: 2, itemId: 1, sentDate: threeDaysAgo, read: 1 }),
      notif({ id: 3, itemId: 1, sentDate: '2020-01-01', read: 1 }),
    ]);
    const { wrapper } = await mountView();
    const dates = wrapper.findAll('.notif-date');
    expect(dates[0].text()).toBe('今天');
    expect(dates[1].text()).toBe('3 天前');
    expect(dates[2].text()).toBe('2020年1月1日'); // 跨年 → 带年份消歧
  });

  it('L1「全部完成」只在收件箱视图且有未完成项时显示', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 1, sentDate: today, read: 1 }), // 已读未完成（收件箱）
      notif({ id: 3, itemId: 1, sentDate: earlier, read: 1, done: 1 }),
    ]);
    const { wrapper } = await mountView();
    // 默认收件箱视图且有未完成项 → 显示
    expect(wrapper.find('.mark-all').exists()).toBe(true);

    // 未读视图（空）→ 不显示
    await wrapper.findAll('.chip')[1].trigger('click');
    await flushPromises();
    expect(wrapper.find('.mark-all').exists()).toBe(false);

    // 已完成视图 → 不显示
    await wrapper.findAll('.chip')[2].trigger('click');
    await flushPromises();
    expect(wrapper.find('.mark-all').exists()).toBe(false);
  });

  it('R1 行首头像：名称首字 + 紧急度色调；物品已删显 ?；已完成灰化 + R3 badge 灰调', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 11, type: 'expired', itemName: '感冒灵颗粒', sentDate: today, read: 1, done: 1 }),
      notif({ id: 2, itemId: 12, type: 'expiring_soon', itemName: null, sentDate: today, read: 0 }), // 名称走 join
      notif({ id: 3, itemId: 999, sentDate: today, read: 1 }), // 物品已删
    ]);
    vi.mocked(api.listItems).mockReset().mockImplementation(async () => [
      makeItem({ id: 12, name: '鲜牛奶', effectiveExpiryDate: daysFromToday(2), expiryStatus: 'expiring' }),
    ]);
    const { wrapper } = await mountView();
    // 已完成视图 → 头像灰化 + badge 灰调
    await wrapper.findAll('.chip')[2].trigger('click');
    await flushPromises();
    const doneRow = wrapper.findAll('.notification-item')[0];
    expect(doneRow.find('.notif-ava').classes()).toContain('ava-gray');
    expect(doneRow.find('.notif-ava').text()).toBe('感');
    expect(doneRow.find('.notif-title').classes()).toContain('tone-gray');

    // 收件箱：expired 红 / expiring 黄；已删物品显 ?
    await wrapper.findAll('.chip')[0].trigger('click');
    await flushPromises();
    const avas = wrapper.findAll('.notif-ava');
    expect(avas[0].classes()).toContain('ava-yellow'); // 鲜牛奶（join）
    expect(avas[0].text()).toBe('鲜');
    expect(avas[1].classes()).toContain('ava-gray');
    expect(avas[1].text()).toBe('?'); // 物品已删
  });

  it('L2 页头未读二态：有未读红字；未读 0 显示「收件箱已清空」', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 1, itemId: 1, sentDate: today, read: 0 }),
    ]);
    const { wrapper } = await mountView();
    expect(wrapper.find('.unread-count').text()).toContain('1 条未读');

    vi.mocked(api.listNotifications).mockResolvedValue([
      notif({ id: 2, itemId: 1, sentDate: today, read: 1 }),
    ]);
    const w2 = await mountView();
    expect(w2.wrapper.find('.inbox-clear').text()).toBe('收件箱已清空');
    expect(w2.wrapper.find('.unread-count').exists()).toBe(false);
  });
});

describe('NotifCenterView 发送日志', () => {
  it('默认折叠（Grid 0fr，内容常驻），展开后渲染渠道与消息', async () => {
    vi.mocked(api.listNotificationLogs).mockResolvedValue([
      { id: 1, channel: 'email', level: 'error', message: 'SMTP 连接失败', createdAt: '2026-11-07T08:00:00.000Z' },
      { id: 2, channel: 'inapp', level: 'info', message: '已送达 4 条提醒', createdAt: '2026-11-07T08:00:05.000Z' },
    ]);
    const { wrapper } = await mountView();
    const collapse = wrapper.find('.logs-collapse');
    expect(collapse.exists()).toBe(true);
    expect(collapse.classes()).not.toContain('open');

    await wrapper.find('.btn-ghost').trigger('click');
    expect(wrapper.find('.logs-collapse').classes()).toContain('open');
    const panel = wrapper.find('.logs-panel');
    expect(panel.exists()).toBe(true);
    const rows = panel.findAll('.log-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('邮件');
    expect(rows[0].text()).toContain('SMTP 连接失败');
    expect(rows[1].text()).toContain('应用内');
  });
});
