/**
 * 库存页 PC 充实化测试：概览条、状态筛选、临期优先排序、快捷开封、筛选空态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    updateItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
  },
}));

import { api } from '../api';
import InventoryView from './InventoryView.vue';

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '鲜牛奶',
    categoryId: null,
    purchaseDate: null,
    quantity: 2,
    unit: '盒',
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

async function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: InventoryView },
      { path: '/items/:id', component: { template: '<div />' } },
      { path: '/items/:id/edit', component: { template: '<div />' } },
      { path: '/items/new', component: { template: '<div />' } },
      { path: '/archive', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

const LIST = [
  makeItem({ id: 1, name: '全麦面包', expiryStatus: 'expired', effectiveExpiryDate: '2026-11-06', price: 9.9, quantity: 1 }),
  makeItem({ id: 2, name: '鲜牛奶', expiryStatus: 'expiring', effectiveExpiryDate: '2026-11-09', price: 12.9, quantity: 2 }),
  makeItem({ id: 3, name: '鸡蛋', expiryStatus: 'ok', effectiveExpiryDate: '2026-11-20', price: 0.9, quantity: 30 }),
  makeItem({ id: 4, name: '抽纸', expiryStatus: 'none', expiryDate: null, effectiveExpiryDate: null, price: 14.9, quantity: 2, opened: 1 }),
  makeItem({ id: 5, name: '白砂糖', expiryStatus: 'none', expiryDate: null, effectiveExpiryDate: null, source: 'shopping' }),
  makeItem({ id: 6, name: '大米 5kg', expiryStatus: 'ok', effectiveExpiryDate: '2026-12-30', price: 9, quantity: 1, minQuantity: 2 }),
];

/** 冻结今天为 2026-11-07（daysLeft 依赖 Date） */
async function mountAt() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T12:00:00'));
  const router = await makeRouter();
  const wrapper = mount(InventoryView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.mocked(api.listItems).mockReset().mockResolvedValue(LIST);
  vi.mocked(api.listCategories).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('InventoryView 概览条', () => {
  it('全量口径统计：在库/临期/过期/开封/长期/待补/低库存 7 状态卡 + 总价值（2026-11-11 I-2/I-5 拆卡）', async () => {
    const wrapper = await mountAt();
    const cards = wrapper.findAll('.ov-card');
    expect(cards).toHaveLength(8);
    expect(cards[0].text()).toContain('6'); // 在库
    expect(cards[1].text()).toContain('1'); // 临期
    expect(cards[2].text()).toContain('1'); // 过期
    expect(cards[3].text()).toContain('1'); // 开封
    expect(cards[5].text()).toContain('1'); // 待补日期 1（白砂糖 shopping 来源）
    expect(cards[6].text()).toContain('1'); // 低库存 1
    // 9.9 + 12.9×2 + 0.9×30 + 14.9×2 + 0 + 9×1 = 101.5
    expect(cards[7].text()).toContain('¥101.50');
  });

  it('状态卡即筛选入口：点击置 active 且 aria-pressed 同步（2026-11-11 I-2）', async () => {
    const wrapper = await mountAt();
    const cards = () => wrapper.findAll('button.ov-card');
    expect(cards()[1].attributes('aria-pressed')).toBe('false');
    await cards()[1].trigger('click'); // 临期
    expect(cards()[1].classes()).toContain('active');
    expect(cards()[1].attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('.inv-row')).toHaveLength(1);
  });
});

describe('InventoryView 状态筛选', () => {
  it('各状态卡过滤列表；「在库物品」恢复全部（2026-11-11 I-2 后入口为概览卡）', async () => {
    const wrapper = await mountAt();
    const cards = () => wrapper.findAll('button.ov-card');
    expect(wrapper.findAll('.inv-row')).toHaveLength(6);

    await cards()[1].trigger('click'); // 临期
    expect(wrapper.findAll('.inv-row')).toHaveLength(1);
    expect(wrapper.findAll('.inv-row')[0].text()).toContain('鲜牛奶');

    await cards()[2].trigger('click'); // 已过期
    expect(wrapper.findAll('.inv-row')[0].text()).toContain('全麦面包');

    await cards()[3].trigger('click'); // 已开封
    expect(wrapper.findAll('.inv-row')[0].text()).toContain('抽纸');

    await cards()[0].trigger('click'); // 在库物品 = 全部
    expect(wrapper.findAll('.inv-row')).toHaveLength(6);
  });

  it('筛选无结果 → 「没有符合筛选条件的物品」', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ id: 1, expiryStatus: 'none', effectiveExpiryDate: null })]);
    const wrapper = await mountAt();
    const cards = () => wrapper.findAll('button.ov-card');
    await cards()[1].trigger('click'); // 临期（无匹配）
    expect(wrapper.text()).toContain('没有符合筛选条件的物品');
    expect(wrapper.findAll('.inv-row')).toHaveLength(0);
  });
});

describe('InventoryView 价值列语义（2026-11-11 I-1）', () => {
  it('「价值」列显示 price×quantity 总额，名称副标显示单价；未填价格显 —', async () => {
    const wrapper = await mountAt();
    const rows = wrapper.findAll('.inv-row');
    const milk = rows.find((r) => r.text().includes('鲜牛奶'))!;
    // 12.9 × 2 = 25.80 在「价值」列；¥12.9 单价在名称副标
    expect(milk.text()).toContain('¥25.80');
    expect(milk.text()).toContain('¥12.9');
    const sugar = rows.find((r) => r.text().includes('白砂糖'))!;
    expect(sugar.text()).toContain('—');
  });
});

describe('InventoryView 临期优先排序', () => {  it('行序：过期 → 临期 → 在库（按到期日）→ 长期', async () => {
    const wrapper = await mountAt();
    const rows = wrapper.findAll('.inv-row');
    expect(rows[0].text()).toContain('全麦面包');
    expect(rows[1].text()).toContain('鲜牛奶');
    expect(rows[2].text()).toContain('鸡蛋');
    expect(rows[3].text()).toContain('大米 5kg');
  });

  it('到期列展示剩余天数与过期天数', async () => {
    const wrapper = await mountAt();
    const rows = wrapper.findAll('.inv-row');
    expect(rows[0].text()).toContain('已过期 1 天');
    expect(rows[1].text()).toContain('剩 2 天');
  });
});

describe('InventoryView 快捷开封', () => {
  it('开封 → 就地替换为 server 返回值，徽章变已开封', async () => {
    const updated = makeItem({ id: 2, name: '鲜牛奶', expiryStatus: 'expiring', effectiveExpiryDate: '2026-11-09', opened: 1 });
    vi.mocked(api.updateItem).mockResolvedValue(updated);
    const wrapper = await mountAt();
    const row = wrapper.findAll('.inv-row')[1]; // 鲜牛奶
    await row.find('.open-toggle').trigger('click');
    await flushPromises();

    expect(api.updateItem).toHaveBeenCalledWith(2, { opened: 1 });
    // 概览开封数 +1（就地更新 allItems）
    expect(wrapper.findAll('.ov-card')[3].text()).toContain('2');
    const rowAfter = wrapper.findAll('.inv-row')[1];
    expect(rowAfter.find('.open-toggle').text()).toBe('取消开封');
    // 项目口径：过期/临期优先于开封角标（badgeFor），开封状态由「取消开封」按钮体现
    expect(rowAfter.find('.badge').text()).toBe('临期');
  });

  it('开封失败 → 错误文案展示', async () => {
    vi.mocked(api.updateItem).mockRejectedValue(new Error('网络错误'));
    const wrapper = await mountAt();
    const row = wrapper.findAll('.inv-row')[1];
    await row.find('.open-toggle').trigger('click');
    await flushPromises();
    expect(wrapper.find('.error-text').text()).toContain('网络错误');
  });
});

describe('I-2 数量步进连点不丢更新', () => {
  it('I-2 行内步进挂起中按钮禁用：连点不产生第二个并发 PUT（不丢不重）', async () => {
    // 多批次同名 → 组可展开 → 批次行内有步进按钮
    const milk1 = makeItem({ id: 31, name: '鲜牛奶', quantity: 2, expiryStatus: 'expiring', effectiveExpiryDate: '2026-11-09', price: 12.9 });
    const milk2 = makeItem({ id: 32, name: '鲜牛奶', quantity: 1, expiryStatus: 'expiring', effectiveExpiryDate: '2026-11-10', price: 12.9 });
    vi.mocked(api.listItems).mockReset().mockResolvedValue([milk1, milk2]);

    let release!: (v: ItemDto) => void;
    const firstPut = new Promise<ItemDto>((r) => (release = r));
    const calls: Array<{ id: number; quantity: number }> = [];
    vi.mocked(api.updateItem).mockReset().mockImplementation((id: number, patch: { quantity?: number }) => {
      calls.push({ id, quantity: patch.quantity ?? 0 });
      if (calls.length === 1) return firstPut;
      return Promise.resolve({ ...milk1, quantity: patch.quantity ?? 0 });
    });

    const wrapper = await mountAt();
    // 展开多批次组
    await wrapper.find('.inv-group-toggle').trigger('click');
    await flushPromises();

    const plus = () =>
      wrapper
        .findAll('button.qty-step-btn')
        .find((b) => b.attributes('aria-label')?.includes('增加'))!;

    await plus().trigger('click'); // PUT(3) 挂起，按钮 disabled
    await flushPromises();
    expect(plus().attributes('disabled')).toBeDefined(); // in-flight 禁用

    await plus().trigger('click'); // disabled 元素不派发 click → 无第二次 PUT
    await flushPromises();
    expect(calls).toHaveLength(1);

    release({ ...milk1, quantity: 3 } as ItemDto);
    await flushPromises();
    expect(calls).toHaveLength(1); // 第二次点击未产生请求（不丢不重）
  });
});

describe('I-7 移动端同名聚合', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false, // 移动卡片分支
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    vi.mocked(api.listItems).mockReset().mockResolvedValue([
      makeItem({ id: 41, name: '鲜牛奶', quantity: 2, expiryStatus: 'expiring', effectiveExpiryDate: '2026-11-09', price: 12.9 }),
      makeItem({ id: 42, name: '鲜牛奶', quantity: 1, expiryStatus: 'ok', effectiveExpiryDate: '2026-11-20', price: 12.9 }),
      makeItem({ id: 43, name: '鸡蛋', quantity: 30, expiryStatus: 'ok', effectiveExpiryDate: '2026-11-20', price: 0.9 }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('多批次同名 → 组卡片（N 批 + 共 N 件）可展开批次；单批次保持原卡片', async () => {
    const router = await makeRouter();
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();

    const cards = wrapper.findAll('.item-card');
    // 2 组：鲜牛奶（聚合组）+ 鸡蛋（单批次原卡）
    expect(cards.length).toBe(2);
    const groupCard = cards.find((c) => c.text().includes('鲜牛奶'))!;
    expect(groupCard.text()).toContain('2 批');
    expect(groupCard.text()).toContain('共 3');
    // 批次默认收起
    expect(groupCard.find('.batch-list').exists()).toBe(false);

    // 点组头展开 → 2 行批次
    await groupCard.find('.item-card-btn').trigger('click');
    await flushPromises();
    const batches = groupCard.findAll('.batch-list .batch-row');
    expect(batches.length).toBe(2);
    expect(batches[0].text()).toContain('有效期');
    // 点批次行 → 开物品详情（桌面语义为抽屉，移动为跳页——此分支 matchMedia=false → 跳页）
    await batches[0].find('.item-card-btn').trigger('click');
    await flushPromises();
  });
});

describe('InventoryView 物品图片缩略图（0006）', () => {
  it('有图物品 avatar 显示图片（lazy img），无图回落首字母色块', async () => {
    // 默认 matchMedia 不匹配 → 移动卡片视图（两视图共用 ItemAvatar，断言一处）
    vi.mocked(api.listItems).mockReset().mockResolvedValue([
      makeItem({ id: 90, name: '带图牛奶', imagePath: `${'a'.repeat(32)}.jpg`, expiryStatus: 'ok', effectiveExpiryDate: '2026-12-01' }),
      makeItem({ id: 91, name: '无图面包', expiryStatus: 'ok', effectiveExpiryDate: '2026-12-01' }),
    ]);
    const wrapper = await mountAt();

    const imgs = wrapper.findAll('img.avatar-img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attributes('src')).toBe(`/api/uploads/${'a'.repeat(32)}.jpg?token=`);
    expect(imgs[0].attributes('loading')).toBe('lazy');
    // 无图物品仍是首字母色块
    const letters = wrapper.findAll('span.avatar').map((s) => s.text());
    expect(letters.some((t) => t.includes('无'))).toBe(true);
  });
});
