/**
 * Task6 RED — 购物清单前端（M5.1/M5.2）与库存「待补过期日」提示（M5.3）。
 * - ShoppingView：待购/已完成分区、添加、勾选流转、转库存、清空已完成、删除、空态
 * - InventoryView：近期转库存且无过期日的物品显示徽章，点击进入编辑页
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ItemDto, ShoppingItemDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    listShoppingItems: vi.fn(async () => []),
    createShoppingItem: vi.fn(),
    updateShoppingItem: vi.fn(),
    deleteShoppingItem: vi.fn(),
    convertShoppingItem: vi.fn().mockResolvedValue({
      item: {
        id: 99,
        name: 'converted',
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
        source: 'shopping',
        effectiveExpiryDate: null,
        expiryStatus: 'none',
      },
      shoppingItem: {
        id: 1,
        name: 'converted',
        quantity: 1,
        unit: null,
        price: null,
        categoryId: null,
        status: 'converted',
      },
    }),
    clearConvertedShoppingItems: vi.fn(),
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
  },
}));

import { api } from '../api';
import ShoppingView from '../views/ShoppingView.vue';
import InventoryView from '../views/InventoryView.vue';

function makeShopping(patch: Partial<ShoppingItemDto>): ShoppingItemDto {
  return {
    id: 1,
    name: '牛奶',
    quantity: 1,
    unit: null,
    price: null,
    categoryId: null,
    status: 'pending',
    ...patch,
  };
}

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '转库存牛奶',
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
    effectiveExpiryDate: null,
    expiryStatus: 'none',
    ...patch,
  };
}

function localDateTimeISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function makeRouter(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: InventoryView },
      { path: '/list', component: ShoppingView },
      { path: '/items/:id', component: { template: '<div/>' } },
      { path: '/items/:id/edit', component: { template: '<div/>' } },
      { path: '/archive', component: { template: '<div/>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listShoppingItems).mockResolvedValue([]);
  vi.mocked(api.listItems).mockResolvedValue([]);
  vi.mocked(api.listCategories).mockResolvedValue([]);
});

describe('ShoppingView 分区与空态', () => {
  it('待购与已完成分区展示，converted 不出现，且出现「清空已转换」', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 1, name: '已完成牛奶', status: 'done' }),
      makeShopping({ id: 2, name: '待购纸巾', status: 'pending' }),
      makeShopping({ id: 3, name: '已转库存项', status: 'converted' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.pending-section').text()).toContain('待购纸巾');
    expect(wrapper.find('.done-section').text()).toContain('已完成牛奶');
    expect(wrapper.text()).not.toContain('已转库存项');
    expect(wrapper.find('.clear-converted').exists()).toBe(true);
    expect(wrapper.find('.clear-converted').text()).toContain('清空已转换');
  });

  it('空状态文案友好', async () => {
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    const empty = wrapper.find('.empty-state');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('清单还是空的');
    expect(wrapper.find('.clear-converted').exists()).toBe(false);
  });
});

describe('ShoppingView 充实化（合计/折叠/低库存建议）', () => {
  it('待购预计花费合计 = Σ(price×quantity)，两位小数', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 1, name: '酱油', quantity: 1, price: 15.5, status: 'pending' }),
      makeShopping({ id: 2, name: '卫生纸', quantity: 2, price: 19.9, status: 'pending' }),
      makeShopping({ id: 3, name: '无价项', quantity: 1, price: null, status: 'pending' }),
      makeShopping({ id: 4, name: '已完成不算', quantity: 5, price: 99, status: 'done' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.find('.pending-count').text()).toContain('¥55.30'); // 15.5 + 19.9×2
  });

  it('已完成区可折叠：默认收起（2026-11-11 L-2），Grid 0fr→1fr 切 open 类，内容常驻', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 1, name: '已完成牛奶', status: 'done' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();
    // 铁律 7：内容常驻 DOM，仅切换 .open（grid-template-rows 0fr→1fr）；默认折叠
    const collapse = () => wrapper.find('.done-section .collapse');
    expect(collapse().exists()).toBe(true);
    expect(collapse().classes()).not.toContain('open');
    expect(wrapper.find('.done-section .shopping-list').exists()).toBe(true);

    await wrapper.find('.section-toggle').trigger('click');
    expect(collapse().classes()).toContain('open');
    expect(collapse().find('.shopping-list').exists()).toBe(true); // 仍常驻，仅展开

    await wrapper.find('.section-toggle').trigger('click');
    expect(collapse().classes()).not.toContain('open');
  });

  it('I-5 低库存建议：数量 = 阈值即触发（规格 S1「数量 ≤ 阈值」）；现存 < 阈值同屏', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 1, name: '大米 5kg', status: 'pending' }),
    ]);
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({
        id: 11,
        name: '鸡蛋',
        quantity: 5,
        unit: '枚',
        price: 0.9,
        minQuantity: 10,
        expiryStatus: 'ok',
      }),
      makeItem({ id: 12, name: '大米 5kg', quantity: 1, minQuantity: 2, expiryStatus: 'ok' }), // 已在待购，不重复建议
      makeItem({ id: 13, name: '充足项', quantity: 9, minQuantity: 2, expiryStatus: 'ok' }), // 未低于阈值
      makeItem({ id: 14, name: '牛奶', quantity: 1, minQuantity: 1, expiryStatus: 'ok' }), // I-5：恰好等于阈值 → 建议
    ]);
    vi.mocked(api.createShoppingItem).mockResolvedValue(
      makeShopping({ id: 99, name: '鸡蛋', status: 'pending' }),
    );
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    const suggestions = wrapper.findAll('.shopping-item.suggestion');
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].text()).toContain('鸡蛋');
    expect(suggestions[0].text()).toContain('现存 5');
    expect(suggestions[1].text()).toContain('牛奶'); // I-5：= 阈值也触发

    await suggestions[0].find('button.convert').trigger('click');
    await flushPromises();
    expect(api.createShoppingItem).toHaveBeenCalledWith({
      name: '鸡蛋',
      quantity: 5, // 缺口 = 10 - 5
      unit: '枚',
      price: 0.9,
      categoryId: null,
    });
  });
});

describe('ShoppingView 增删改与转库存', () => {
  it('添加输入行（名称+数量+单位）→ createShoppingItem 后重拉', async () => {
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.add-name').setValue('纸巾');
    await wrapper.find('.add-quantity').setValue('2');
    await wrapper.find('.add-unit').setValue('包');
    await wrapper.find('form.add-form').trigger('submit');
    await flushPromises();

    expect(api.createShoppingItem).toHaveBeenCalledWith({
      name: '纸巾',
      quantity: 2,
      unit: '包',
      price: null,
      categoryId: null,
    });
    expect(api.listShoppingItems).toHaveBeenCalledTimes(2);
  });

  it('添加行含单价与类别（M5.2 Given「牛奶 2 盒，单价 12 元」可真实走通）', async () => {
    vi.mocked(api.listCategories).mockResolvedValue([{ id: 7, name: '饮品', sortOrder: null }]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.add-name').setValue('牛奶');
    await wrapper.find('.add-quantity').setValue('2');
    await wrapper.find('.add-unit').setValue('盒');
    await wrapper.find('.add-price').setValue('12');
    await wrapper.find('.add-category').setValue('7');
    await wrapper.find('form.add-form').trigger('submit');
    await flushPromises();

    expect(api.createShoppingItem).toHaveBeenCalledWith({
      name: '牛奶',
      quantity: 2,
      unit: '盒',
      price: 12,
      categoryId: 7,
    });
  });

  it('数量留空默认 1（brief：quantity 可选默认 1）', async () => {
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.add-name').setValue('电池');
    await wrapper.find('form.add-form').trigger('submit');
    await flushPromises();

    expect(api.createShoppingItem).toHaveBeenCalledWith({
      name: '电池',
      quantity: 1,
      unit: null,
      price: null,
      categoryId: null,
    });
  });

  it('名称为空 → 不请求并提示', async () => {
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.add-name').setValue('   ');
    await wrapper.find('form.add-form').trigger('submit');
    await flushPromises();

    expect(api.createShoppingItem).not.toHaveBeenCalled();
    expect(wrapper.find('.error-text').text()).toContain('名称');
  });

  it('修改数量（M5.1）→ updateShoppingItem(id,{quantity}) 后重拉', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValueOnce([
      makeShopping({ id: 11, name: '牛奶', status: 'pending', quantity: 2, unit: '盒' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    const qty = wrapper.find('.shopping-item .qty-edit');
    expect(qty.exists()).toBe(true);
    (qty.element as HTMLInputElement).value = '3';
    await qty.trigger('change');
    await flushPromises();

    expect(api.updateShoppingItem).toHaveBeenCalledWith(11, { quantity: 3 });
    expect(api.listShoppingItems).toHaveBeenCalledTimes(2);
  });

  it('勾选 pending → status=done；已完成改回 pending', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValueOnce([
      makeShopping({ id: 5, name: '待购项', status: 'pending' }),
    ]);
    let router = await makeRouter('/list');
    let wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('.shopping-item.pending .toggle').trigger('click');
    await flushPromises();
    expect(api.updateShoppingItem).toHaveBeenCalledWith(5, { status: 'done' });

    vi.mocked(api.listShoppingItems).mockResolvedValueOnce([
      makeShopping({ id: 6, name: '已完成项', status: 'done' }),
    ]);
    router = await makeRouter('/list');
    wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('.shopping-item.done .toggle').trigger('click');
    await flushPromises();
    expect(api.updateShoppingItem).toHaveBeenCalledWith(6, { status: 'pending' });
  });

  it('转为库存：done 项按钮 → convertShoppingItem 后重拉', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValueOnce([
      makeShopping({ id: 9, name: '待转牛奶', status: 'done', quantity: 2, unit: '盒' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.shopping-item.done .convert').trigger('click');
    await flushPromises();
    expect(api.convertShoppingItem).toHaveBeenCalledWith(9);
    expect(api.listShoppingItems).toHaveBeenCalledTimes(2);
  });

  it('清空已转换需二次确认 → clearConvertedShoppingItems 后重拉', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValueOnce([
      makeShopping({ id: 3, name: '已转库存项', status: 'converted' }),
    ]);
    vi.mocked(api.clearConvertedShoppingItems).mockResolvedValue({ deleted: 1 });
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.clear-converted').trigger('click');
    await flushPromises();
    expect(api.clearConvertedShoppingItems).not.toHaveBeenCalled();
    expect(wrapper.find('.clear-converted').text()).toContain('确认');

    await wrapper.find('.clear-converted').trigger('click');
    await flushPromises();
    expect(api.clearConvertedShoppingItems).toHaveBeenCalledTimes(1);
    expect(api.listShoppingItems).toHaveBeenCalledTimes(2);
  });

  it('删除 → deleteShoppingItem(id) 后重拉', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValueOnce([
      makeShopping({ id: 7, name: '待删项', status: 'pending' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.shopping-item .delete').trigger('click');
    await flushPromises();
    expect(api.deleteShoppingItem).toHaveBeenCalledWith(7);
    expect(api.listShoppingItems).toHaveBeenCalledTimes(2);
  });
});

describe('InventoryView 待补过期日（M5.3，仅转库存来源）', () => {
  // 待补过期日 CTA 与卡片行为属于移动端卡片视图，锁定非桌面断点
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
  });

  it('shopping 来源且近期无过期日 → 只显示「待补过期日」；卡片进详情、徽章进编辑', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({
        id: 7,
        name: '转库存牛奶',
        source: 'shopping',
        createdAt: localDateTimeISO(new Date(Date.now() - 86400000)),
      }),
    ]);
    const router = await makeRouter('/');
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();

    const hint = wrapper.find('.expiry-hint');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('待补过期日');
    // 与「长期」徽章互斥：不再同时出现（「长期」筛选 chip 文案不算）
    expect(wrapper.findAll('.badge').some((b) => b.text() === '长期')).toBe(false);

    // 卡片点击仍进详情（M1.6 归档入口不被切断）
    await wrapper.find('.item-card-btn').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/items/7');

    // 徽章点击才进编辑页补填
    await wrapper.find('.expiry-hint').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/items/7/edit');
  });

  it('手动录入（manual）无过期日 → 不显示待补提示，卡片进详情（M3.4 长期存储品）', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({
        id: 8,
        name: '长期盐',
        source: 'manual',
        createdAt: localDateTimeISO(new Date(Date.now() - 86400000)),
      }),
    ]);
    const router = await makeRouter('/');
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.expiry-hint').exists()).toBe(false);
    expect(wrapper.text()).toContain('长期');
    await wrapper.find('.item-card-btn').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/items/8');
  });

  it('shopping 来源但创建已久 → D-3 修订后欠账常驻，仍显示待补提示', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({
        id: 9,
        name: '旧转库存',
        source: 'shopping',
        createdAt: localDateTimeISO(new Date(Date.now() - 30 * 86400000)),
      }),
    ]);
    const router = await makeRouter('/');
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.expiry-hint').exists()).toBe(true);
  });
});

describe('ShoppingView 待购直达转库存（D-7 后 pending 直接转换）', () => {
  it('待购行点「转为库存」→ 直接调 convert 并提示', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 5, name: '香蕉', status: 'pending', quantity: 2, unit: '把' }),
    ]);
    vi.mocked(api.convertShoppingItem).mockResolvedValue({
      item: makeItem({ id: 99, name: '香蕉', quantity: 2, unit: '把', source: 'shopping' }),
      shoppingItem: makeShopping({ id: 5, status: 'converted' }),
    });
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.shopping-item.pending .convert').trigger('click');
    await flushPromises();
    expect(api.convertShoppingItem).toHaveBeenCalledWith(5);
    expect(wrapper.text()).toContain('已转入库存');
    expect(api.updateShoppingItem).not.toHaveBeenCalled();
  });

  it('转换失败 → 行内错误提示', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 5, name: '香蕉', status: 'pending' }),
    ]);
    vi.mocked(api.convertShoppingItem).mockRejectedValue(new Error('网络错误'));
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('.shopping-item.pending .convert').trigger('click');
    await flushPromises();
    expect(wrapper.find('.error-text').text()).toContain('网络错误');
  });
});

describe('ShoppingView 全部转为库存（D-4 批量）', () => {
  it('批量逐件 convert，成功后汇总提示并重拉', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 1, name: '面粉', status: 'done' }),
      makeShopping({ id: 2, name: '电池', status: 'done' }),
      makeShopping({ id: 3, name: '香蕉', status: 'pending' }), // pending 不参与
    ]);
    vi.mocked(api.convertShoppingItem).mockResolvedValue({
      item: makeItem({ id: 99 }),
      shoppingItem: makeShopping({ id: 1, status: 'converted' }),
    });
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();

    const btn = wrapper.find('.convert-all');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(api.convertShoppingItem).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('已转入 2 件库存');
  });

  it('无可转换项时不显示批量按钮', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      makeShopping({ id: 1, name: '香蕉', status: 'pending' }),
    ]);
    const router = await makeRouter('/list');
    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.find('.convert-all').exists()).toBe(false);
  });
});

describe('W-M3 添加按钮 in-flight 守卫', () => {
  it('提交挂起中再次提交不重复创建（按钮 :disabled）', async () => {
    const router = await makeRouter('/list');
    let release!: (v: unknown) => void;
    const first = new Promise<unknown>((r) => (release = r));
    vi.mocked(api.createShoppingItem).mockReset().mockImplementation(() => first as never);

    const wrapper = mount(ShoppingView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('.add-name').setValue('纸巾W-M3');

    const form = wrapper.find('form.add-form');
    await form.trigger('submit'); // 第一次提交挂起
    await flushPromises();
    const submit = wrapper.find('.add-submit');
    expect(submit.attributes('disabled')).toBeDefined(); // in-flight 禁用

    await form.trigger('submit'); // disabled 期间再提交
    await flushPromises();
    expect(api.createShoppingItem).toHaveBeenCalledTimes(1); // RED：现状 2 次

    release({ id: 1, name: '纸巾W-M3' } as never);
    await flushPromises();
  });
});
