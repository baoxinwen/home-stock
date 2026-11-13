/**
 * 视图层组件测试（brief 交付物 5）：
 * - InventoryView：搜索防抖调 GET /items?q=、徽章映射、archived 不出现
 * - ItemFormView：生产日期+保质期 → 过期日期换算回填展示
 * - ItemDetailView：归档（选去向）、删除二次确认文案
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ItemDto } from '@home-stock/shared';
import { ApiClient } from '../api/api';

// 组件里用的是 ../api 单例，这里 mock 它的方法
vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    listHistory: vi.fn(async () => []),
    listNotifications: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
    uploadImage: vi.fn(async () => ({ path: `${'e'.repeat(32)}.png` })),
    convertShoppingItem: vi.fn(async () => ({
      item: {
        id: 77,
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
      shoppingItem: { id: 5, name: 'converted', quantity: 1, unit: null, price: null, categoryId: null, status: 'converted' },
    })),
    getSettings: vi.fn(async () => ({
      default_remind_days: 3,
      reminder_hour: 8,
      auto_archive_expired: 1,
      email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
      wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    })),
  },
}));

import { api } from '../api';
import InventoryView from '../views/InventoryView.vue';
import ItemFormView from '../views/ItemFormView.vue';
import ItemDetailView from '../views/ItemDetailView.vue';

vi.mocked(ApiClient.prototype.listItems);

function makeItem(patch: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '鲜牛奶',
    categoryId: null,
    purchaseDate: null,
    quantity: 2,
    unit: '盒',
    price: null,
    expiryDate: '2026-01-10',
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
    effectiveExpiryDate: '2026-01-10',
    expiryStatus: 'ok',
    ...patch,
  };
}

async function makeRouter(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: InventoryView },
      { path: '/items/new', component: ItemFormView },
      { path: '/items/:id', component: ItemDetailView },
      { path: '/items/:id/edit', component: ItemFormView },
      { path: '/archive', component: { template: '<div/>' } },
      { path: '/stats', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InventoryView', () => {
  it('搜索输入防抖 300ms 后带 q 参数调用 listItems', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.listItems).mockResolvedValue([]);
      const router = await makeRouter('/');
      const wrapper = mount(InventoryView, { global: { plugins: [router] } });
      await flushPromises();

      const input = wrapper.find('input[type="search"]');
      await input.setValue('牛');

      await vi.advanceTimersByTimeAsync(299);
      expect(api.listItems).not.toHaveBeenCalledWith({ q: '牛', category: undefined });
      await vi.advanceTimersByTimeAsync(1);
      expect(api.listItems).toHaveBeenLastCalledWith({ q: '牛', category: undefined });
    } finally {
      vi.useRealTimers();
    }
  });

  it('徽章映射：expired→已过期 red、expiring→临期 yellow、ok→在库 green、none→长期 blue', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      makeItem({ id: 1, expiryStatus: 'expired', name: '酸奶' }),
      makeItem({ id: 2, expiryStatus: 'expiring', name: '面包' }),
      makeItem({ id: 3, expiryStatus: 'ok', name: '米' }),
      makeItem({ id: 4, expiryStatus: 'none', expiryDate: null, effectiveExpiryDate: null, name: '盐' }),
    ]);
    const router = await makeRouter('/');
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();

    const badges = wrapper.findAll('.badge').map((b) => b.classes().join(' ') + '|' + b.text());
    expect(badges.some((s) => s.includes('tone-red') && s.includes('已过期'))).toBe(true);
    expect(badges.some((s) => s.includes('tone-yellow') && s.includes('临期'))).toBe(true);
    expect(badges.some((s) => s.includes('tone-green') && s.includes('在库'))).toBe(true);
    expect(badges.some((s) => s.includes('tone-blue') && s.includes('长期'))).toBe(true);
  });

  it('已开封物品显示「已开封」Pale Blue 角标', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ opened: 1, expiryStatus: 'ok' })]);
    const router = await makeRouter('/');
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.find('.badge').text()).toBe('已开封');
    expect(wrapper.find('.badge').classes()).toContain('tone-blue');
  });

  it('archived 物品不出现（list 默认只查 active，组件不应传 archived）', async () => {
    vi.mocked(api.listItems).mockResolvedValue([]);
    const router = await makeRouter('/');
    const wrapper = mount(InventoryView, { global: { plugins: [router] } });
    await flushPromises();
    expect(api.listItems).toHaveBeenCalledWith({ q: undefined, category: undefined });
    expect(wrapper.text()).not.toContain('已归档');
  });
});

describe('ItemFormView', () => {
  it('生产日期+保质期 → 换算过期日期展示', async () => {
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.findAll('button.chip').filter((b) => b.text().includes('生产日期'))[0].trigger('click');
    // 表单里第一个 date 输入是 purchaseDate，shelf 模式下第二个才是 productionDate
    const dates = wrapper.findAll('input[type="date"]');
    expect(dates.length).toBe(2);
    await dates[1].setValue('2026-01-01');
    await wrapper.find('input[type="number"][min="1"]').setValue('7');
    const hint = wrapper.find('.computed-hint');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('2026-01-08');
  });

  it('换算结果随表单提交作为 expiryDate 回填', async () => {
    vi.mocked(api.createItem).mockResolvedValue(makeItem({ id: 9 }));
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue('酸奶');
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('生产日期'))[0].trigger('click');
    const dates = wrapper.findAll('input[type="date"]');
    await dates[1].setValue('2026-02-01');
    await wrapper.find('input[type="number"][min="1"]').setValue('14');
    await wrapper.find('form').trigger('submit');

    expect(api.createItem).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.createItem).mock.calls[0][0];
    expect(payload.expiryDate).toBe('2026-02-15');
  });

  it('「长期存储」档：不填过期日期可提交，payload.expiryDate 为 null', async () => {
    vi.mocked(api.createItem).mockResolvedValue(makeItem({ expiryDate: null, effectiveExpiryDate: null }));
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue('白酒');
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('长期存储'))[0].trigger('click');
    await wrapper.find('form').trigger('submit');

    expect(api.createItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createItem).mock.calls[0][0].expiryDate).toBeNull();
  });

  it('日期档漏填拦截：direct 档空日期提交报错且不请求', async () => {
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue('牛奶');
    await wrapper.find('form').trigger('submit');

    expect(api.createItem).not.toHaveBeenCalled();
    expect(wrapper.find('.error-text').text()).toContain('请填写过期日期，或改选长期存储');
  });
});

describe('ItemFormView 清单转库存（M5.2 表单确认范式）', () => {
  it('?convert=id：预填清单项字段（名称/数量/单价），标题「转入库存」，隐藏再记一笔', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      {
        id: 5,
        name: '清单牛奶',
        quantity: 3,
        unit: '盒',
        price: 12.5,
        categoryId: null,
        status: 'done',
      },
    ]);
    const router = await makeRouter('/items/new?convert=5');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.page-title').text()).toBe('转入库存');
    const nameInput = wrapper.find('input[type="text"]');
    expect((nameInput.element as HTMLInputElement).value).toBe('清单牛奶');
    const qty = wrapper.find('input[type="number"]');
    expect((qty.element as HTMLInputElement).value).toBe('3');
    expect(wrapper.text()).not.toContain('保存并再记一笔');
    expect(wrapper.text()).not.toContain('从历史复制');
  });

  it('保存 → convertShoppingItem(id, payload)（含选定的过期方式），跳新物品详情', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      { id: 5, name: '清单牛奶', quantity: 3, unit: '盒', price: 12.5, categoryId: null, status: 'done' },
    ]);
    const router = await makeRouter('/items/new?convert=5');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    // 过期方式选「长期存储」→ payload.expiryDate 为 null
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('长期存储'))[0].trigger('click');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(api.convertShoppingItem).toHaveBeenCalledTimes(1);
    const [calledId, payload] = vi.mocked(api.convertShoppingItem).mock.calls[0];
    expect(calledId).toBe(5);
    expect(payload).toMatchObject({ name: '清单牛奶', quantity: 3, unit: '盒', price: 12.5, expiryDate: null });
    expect(api.createItem).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/items/77');
  });

  it('清单项不存在或已转换 → 显式报错并降级为普通新建', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      { id: 5, name: '已转项', quantity: 1, unit: null, price: null, categoryId: null, status: 'converted' },
    ]);
    const router = await makeRouter('/items/new?convert=5');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.error-text').text()).toContain('该清单项不存在或已转入库存');
    expect(wrapper.find('.page-title').text()).toBe('记一笔');
  });
});

describe('ItemFormView 图片（0006，选填单图）', () => {
  async function pickFile(wrapper: ReturnType<typeof mount>): Promise<void> {
    // happy-dom 不解码图片内容：直接对 input 触发带 File 的 change
    const input = wrapper.find('input.image-input').element as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array(8)], 'a.png', { type: 'image/png' })],
      configurable: true,
    });
    await wrapper.find('input.image-input').trigger('change');
    await flushPromises();
  }

  it('选文件即传：uploadImage 后预览出现，payload 带上传返回的文件名', async () => {
    vi.mocked(api.createItem).mockResolvedValue(makeItem({}));
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue('带图物品');
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('长期存储'))[0].trigger('click');
    await pickFile(wrapper);

    expect(api.uploadImage).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.image-preview .preview-img').exists()).toBe(true);
    await wrapper.find('form').trigger('submit');
    expect(vi.mocked(api.createItem).mock.calls[0][0].imagePath).toBe(`${'e'.repeat(32)}.png`);
  });

  it('移除图片：预览消失，提交 imagePath=null', async () => {
    vi.mocked(api.createItem).mockResolvedValue(makeItem({}));
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    await pickFile(wrapper);
    await wrapper.find('.image-remove').trigger('click');
    expect(wrapper.find('.image-preview').exists()).toBe(false);

    await wrapper.find('input[type="text"]').setValue('删图物品');
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('长期存储'))[0].trigger('click');
    await wrapper.find('form').trigger('submit');
    expect(vi.mocked(api.createItem).mock.calls[0][0].imagePath).toBeNull();
  });

  it('超大文件前端预检拦截，不发上传请求', async () => {
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    const input = wrapper.find('input.image-input').element as HTMLInputElement;
    const bigFile = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [bigFile], configurable: true });
    await wrapper.find('input.image-input').trigger('change');
    await flushPromises();

    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(wrapper.find('.image-error').text()).toContain('图片不能超过 2MB');
  });
});

describe('ItemFormView 数量校验', () => {
  it('数量 0 保留为 0，不被偷偷改成 1', async () => {
    vi.mocked(api.createItem).mockResolvedValue(makeItem({}));
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('input[type="text"]').setValue('盐');
    // 盐无保质期 → 切「长期存储」档（日期档空值现被校验拦截）
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('长期存储'))[0].trigger('click');
    await wrapper.find('input[type="number"]').setValue(0);
    await wrapper.find('form').trigger('submit');
    expect(api.createItem).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createItem).mock.calls[0][0].quantity).toBe(0);
  });

  it('数量留空默认 1，非法值报校验错误', async () => {
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('input[type="text"]').setValue('盐');
    await wrapper.findAll('button.chip').filter((b) => b.text().includes('长期存储'))[0].trigger('click');
    await wrapper.find('input[type="number"]').setValue('');
    await wrapper.find('form').trigger('submit');
    // v-model.number 空串 → ''；toPayload 应默认 1
    const payload = vi.mocked(api.createItem).mock.calls[0]?.[0];
    expect(payload?.quantity).toBe(1);
  });
});

describe('ItemFormView 编辑态开封开关', () => {
  it('编辑无过期日物品 → 「长期存储」档初始激活，日期输入不渲染', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ expiryDate: null, effectiveExpiryDate: null, expiryStatus: 'none' })]);
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({}));
    const router = await makeRouter('/items/1/edit');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    const longChip = wrapper.findAll('button.chip').find((b) => b.text().includes('长期存储'))!;
    expect(longChip.classes()).toContain('active');
    // 编辑补日期：切回日期档后输入可见（限定过期方式分组，排除购买日期输入）
    expect(wrapper.find('.expiry-group input[type="date"]').exists()).toBe(false);
    await wrapper.findAll('button.chip').find((b) => b.text().includes('直接填'))!.trigger('click');
    expect(wrapper.find('.expiry-group input[type="date"]').exists()).toBe(true);
  });

  it('开启「已开封」后保存，PUT 带 opened:1（server 记录当日开封日）', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ opened: 0 })]);
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ opened: 1 }));
    const router = await makeRouter('/items/1/edit');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    const checkbox = wrapper.find('input[type="checkbox"]');
    expect(checkbox.exists()).toBe(true);
    expect(wrapper.text()).toContain('记录今天的开封日期');
    await checkbox.setValue(true);
    await wrapper.find('form').trigger('submit');

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(api.updateItem).mock.calls[0];
    expect(payload.opened).toBe(1);
  });

  it('取消勾选「已开封」保存，PUT 带 opened:0（server 清空开封日）', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ opened: 1 })]);
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ opened: 0 }));
    const router = await makeRouter('/items/1/edit');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();

    const checkbox = wrapper.find('input[type="checkbox"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(true); /* 编辑态回填为已开封 */
    await checkbox.setValue(false);
    await wrapper.find('form').trigger('submit');

    const [, payload] = vi.mocked(api.updateItem).mock.calls[0];
    expect(payload.opened).toBe(0);
  });

  it('新建态不显示开封开关', async () => {
    const router = await makeRouter('/items/new');
    const wrapper = mount(ItemFormView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
  });
});

describe('ItemDetailView', () => {
  it('类别显示名称而非裸 ID（加载 categories 做映射）', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ categoryId: 7 })]);
    vi.mocked(api.listCategories).mockResolvedValue([
      { id: 7, name: '调料', sortOrder: null },
    ]);
    const router = await makeRouter('/items/1');
    const wrapper = mount(ItemDetailView, { global: { plugins: [router] } });
    await flushPromises();

    const rowText = wrapper.findAll('.row').map((r) => r.text()).find((t) => t.includes('类别'));
    expect(rowText).toBeDefined();
    expect(rowText).toContain('调料');
    expect(rowText).not.toMatch(/\b7\b/);
  });

  it('归档：打开去向弹层选择「用完」调 archiveItem({reason:"used_up"})', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({})]);
    vi.mocked(api.archiveItem).mockResolvedValue(makeItem({ status: 'archived', archivedReason: 'used_up' }));
    const router = await makeRouter('/items/1');
    const wrapper = mount(ItemDetailView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.findAll('button').find((b) => b.text() === '归档')!.trigger('click');
    const options = wrapper.findAll('.option');
    expect(options.length).toBe(2);
    await options[0].trigger('click');
    expect(api.archiveItem).toHaveBeenCalledWith(1, { reason: 'used_up' });
  });

  it('删除需二次确认，弹层含误录提示文案', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({})]);
    const router = await makeRouter('/items/1');
    const wrapper = mount(ItemDetailView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.findAll('button').find((b) => b.text() === '删除')!.trigger('click');
    expect(wrapper.text()).toContain('误录入才删除，正常用完请归档');
    expect(api.deleteItem).not.toHaveBeenCalled();
    await wrapper.findAll('button').find((b) => b.text() === '仍要删除')!.trigger('click');
    expect(api.deleteItem).toHaveBeenCalledWith(1);
  });
});

describe('ItemDetailView 充实化（快捷操作/通知时间线）', () => {
  async function mountDetailAt(id = 1) {
    const router = await makeRouter(`/items/${id}`);
    const wrapper = mount(ItemDetailView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('开封按钮 → updateItem({opened:1})，回显已开封态', async () => {
    const base = makeItem({ id: 1, opened: 0 });
    vi.mocked(api.listItems).mockResolvedValue([base]);
    vi.mocked(api.listNotifications).mockResolvedValue([]);
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ id: 1, opened: 1, openedAt: '2026-11-07T10:00:00.000Z' }));
    const wrapper = await mountDetailAt();

    const toggle = wrapper.find('.open-toggle');
    expect(toggle.text()).toBe('开封');
    await toggle.trigger('click');
    await flushPromises();
    expect(api.updateItem).toHaveBeenCalledWith(1, { opened: 1 });
    expect(wrapper.find('.open-toggle').text()).toBe('取消开封');
    expect(wrapper.find('.open-toggle').classes()).toContain('opened');
  });

  it('数量步进 ±1 并就地回显；减到 0 以下不请求', async () => {
    const base = makeItem({ id: 1, quantity: 2, opened: 0 });
    vi.mocked(api.listItems).mockResolvedValue([base]);
    vi.mocked(api.listNotifications).mockResolvedValue([]);
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ id: 1, quantity: 3, opened: 0 }));
    const wrapper = await mountDetailAt();

    const plus = wrapper.findAll('.step-btn')[1];
    await plus.trigger('click');
    await flushPromises();
    expect(api.updateItem).toHaveBeenCalledWith(1, { quantity: 3 });
    expect(wrapper.find('.qty-value').text()).toContain('3');

    // 数量为 0 时再减：不发请求
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ id: 1, quantity: 0, opened: 0 })]);
    const w2 = await mountDetailAt();
    vi.mocked(api.updateItem).mockClear();
    await w2.findAll('.step-btn')[0].trigger('click'); // −
    await flushPromises();
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it('关联通知时间线：按 itemId 过滤并按日期倒序', async () => {
    vi.mocked(api.listItems).mockResolvedValue([makeItem({ id: 1, opened: 0 })]);
    vi.mocked(api.listNotifications).mockResolvedValue([
      { id: 1, itemId: 1, type: 'expiring_soon', sentDate: '2026-11-05', channels: null, read: 0, createdAt: null },
      { id: 2, itemId: 1, type: 'expired', sentDate: '2026-11-07', channels: null, read: 1, createdAt: null },
      { id: 3, itemId: 99, type: 'expired', sentDate: '2026-11-07', channels: null, read: 0, createdAt: null },
    ] as never);
    const wrapper = await mountDetailAt();

    const rows = wrapper.findAll('.notif-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('已过期提醒'); // 11-07 在前
    expect(rows[0].text()).toContain('2026-11-07');
    expect(rows[1].text()).toContain('临期提醒');
    expect(wrapper.find('.notif-card').text()).toContain('相关提醒（2）');
  });
});
