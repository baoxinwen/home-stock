/**
 * 设置页测试（brief 交付物 6）：提醒时刻/默认阈值/自动归档开关、邮件与企微表单、
 * 测试发送按钮、校验、备份恢复、主题切换、类别管理、分组标签页。
 * 通知中心用例在 notif-center.spec.ts（三态收件箱）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { SettingsDto } from '@home-stock/shared';

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    notifyTest: vi.fn(),
    listNotifications: vi.fn(),
    markNotificationsRead: vi.fn(),
    listNotificationLogs: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    listBackups: vi.fn(async () => []),
    restoreBackup: vi.fn(),
    downloadBackup: vi.fn(async () => undefined),
  },
}));

import { api } from '../api';
import { getStoredToken, setStoredToken } from '../auth/token';
import SettingsView from './SettingsView.vue';

function makeSettings(patch: Partial<SettingsDto> = {}): SettingsDto {
  return {
    default_remind_days: 3,
    reminder_hour: 8,
    auto_archive_expired: 1,
    email: {
      enabled: 0,
      smtp_host: null,
      smtp_port: null,
      secure: 0,
      user: null,
      pass: null,
      from: null,
      to: null,
    },
    wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    ...patch,
  };
}

async function makeRouter(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/settings', component: SettingsView },
      { path: '/login', component: { template: '<div>login</div>' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('SettingsView', () => {
  it('加载设置并回填：提醒时刻 / 默认阈值 / 自动归档开关', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings({ reminder_hour: 20, default_remind_days: 5, auto_archive_expired: 0 }));
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    expect((wrapper.find('#reminder-hour').element as HTMLSelectElement).value).toBe('20');
    expect((wrapper.find('#default-remind-days').element as HTMLInputElement).value).toBe('5');
    expect((wrapper.find('#auto-archive').element as HTMLInputElement).checked).toBe(false);
  });

  it('加载失败 → 保存按钮禁用，提交不发请求；重新加载成功后恢复可保存（I-3）', async () => {
    vi.mocked(api.getSettings).mockRejectedValueOnce(new Error('网络错误'));
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.find('.form-error').text()).toContain('网络错误');
    // 类别管理卡也有自己的 submit 按钮，限定主设置表单内
    const saveBtn = wrapper.find('form.settings-form button[type="submit"]');
    expect(saveBtn.attributes('disabled')).toBeDefined();
    await wrapper.find('form.settings-form').trigger('submit');
    await flushPromises();
    expect(api.updateSettings).not.toHaveBeenCalled();

    // 刷新后加载成功 → 失败态清除，恢复可保存
    vi.mocked(api.getSettings).mockResolvedValueOnce(makeSettings());
    const wrapper2 = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper2.find('form.settings-form button[type="submit"]').attributes('disabled')).toBeUndefined();
  });

  it('默认阈值非法（0）→ 阻止保存并显示校验错误', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('#default-remind-days').setValue('0');
    await wrapper.find('form.settings-form').trigger('submit');
    await flushPromises();

    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(wrapper.find('.form-error').text()).toContain('正整数');
  });

  it('保存：提交提醒时刻/阈值/自动归档与邮件渠道（秘密未改动时不覆盖）', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      makeSettings({
        email: {
          enabled: 1,
          smtp_host: 'smtp.qq.com',
          smtp_port: 465,
          secure: 1,
          user: 'a@qq.com',
          pass: '***',
          from: 'a@qq.com',
          to: 'b@qq.com',
        },
      }),
    );
    vi.mocked(api.updateSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('#reminder-hour').setValue('7');
    await wrapper.find('#default-remind-days').setValue('6');
    await wrapper.find('form.settings-form').trigger('submit');
    await flushPromises();

    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(api.updateSettings).mock.calls[0][0];
    expect(payload.reminder_hour).toBe(7);
    expect(payload.default_remind_days).toBe(6);
    expect(payload.email?.smtp_host).toBe('smtp.qq.com');
    // 密码保持 *** 占位（server 侧识别为“不修改”）
    expect(payload.email?.pass).toBe('***');
  });

  it('修改密码后保存带上明文新密码', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      makeSettings({
        email: { enabled: 1, smtp_host: 'smtp.qq.com', smtp_port: 465, secure: 1, user: 'a@qq.com', pass: '***', from: 'a@qq.com', to: 'b@qq.com' },
      }),
    );
    vi.mocked(api.updateSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('#email-pass').setValue('new-secret');
    await wrapper.find('form.settings-form').trigger('submit');
    await flushPromises();
    expect(vi.mocked(api.updateSettings).mock.calls[0][0].email?.pass).toBe('new-secret');
  });

  it('清空密码输入框 → 视为“不修改”，提交 ***（与服务端语义一致）', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      makeSettings({
        email: { enabled: 1, smtp_host: 'smtp.qq.com', smtp_port: 465, secure: 1, user: 'a@qq.com', pass: '***', from: 'a@qq.com', to: 'b@qq.com' },
      }),
    );
    vi.mocked(api.updateSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    const pass = wrapper.find('#email-pass');
    await pass.setValue('abc'); // 先输入再清空
    await pass.setValue('');
    await wrapper.find('form.settings-form').trigger('submit');
    await flushPromises();
    expect(vi.mocked(api.updateSettings).mock.calls[0][0].email?.pass).toBe('***');
  });

  it('测试发送按钮调用 notifyTest(channel) 并展示结果', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.notifyTest).mockResolvedValue({ results: { email: { ok: true } } });
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('button[data-channel="email"]').trigger('click');
    await flushPromises();
    expect(api.notifyTest).toHaveBeenCalledWith('email');
    expect(wrapper.find('.test-result').text()).toContain('成功');
  });

  it('测试发送失败 → 显示失败原因', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.notifyTest).mockResolvedValue({ results: { wecom: { ok: false, error: '企业微信返回错误 40001' } } });
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('button[data-channel="wecom"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.test-result').text()).toContain('40001');
  });
});

describe('SettingsView 备份与恢复（M8）/ 退出登录（M9.2）', () => {
  function selectFile(wrapper: ReturnType<typeof mount>, name = 'backup.db'): File {
    const input = wrapper.find('input.restore-file');
    const file = new File(['sqlite-bytes'], name, { type: 'application/x-sqlite3' });
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    return file;
  }

  function makeRestoreResult() {
    return {
      restored: { items: 3, categories: 1, shoppingItems: 0, notifications: 2, settings: 8 },
      safetyBackup: 'pre-restore-20260101-010101-000.db',
    };
  }

  it('展示备份列表（文件名 + 时间 + 大小）', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.listBackups).mockResolvedValue([
      { name: 'stock-20260101-010101.db', size: 2048, createdAt: '2026-01-01T01:01:01Z' },
    ]);
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    const items = wrapper.findAll('.backup-item');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain('stock-20260101-010101.db');
    expect(items[0].text()).toContain('2.0 KB');
  });

  it('备份下载改为按钮触发 downloadBackup（I-7：口令不再进 URL）', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    const btn = wrapper.find('button.backup-download');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(api.downloadBackup).toHaveBeenCalledTimes(1);
  });

  it('备份下载失败 → 提示错误（不再出现浏览器直接渲染 JSON 页）', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.downloadBackup).mockRejectedValueOnce(new Error('下载失败（HTTP 500）'));
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('button.backup-download').trigger('click');
    await flushPromises();
    expect(wrapper.find('.backup-error').text()).toContain('下载失败');
  });

  it('恢复需要二次确认：应用内面板取消则不调用 API（体检表 P2-11，弃用原生 confirm）', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const confirm = vi.spyOn(window, 'confirm');
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    selectFile(wrapper);
    await wrapper.find('button.restore-btn').trigger('click');
    await flushPromises();

    // 应用内面板出现（而非原生 confirm）
    expect(confirm).not.toHaveBeenCalled();
    const panel = wrapper.find('.panel[role="dialog"]');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('backup.db');

    await panel.find('.confirm-actions .ghost-btn').trigger('click'); // 取消
    await flushPromises();
    // 旧 wrapper 引用不随渲染更新，重新 find 断言面板已移除
    expect(wrapper.find('.panel[role="dialog"]').exists()).toBe(false);
    expect(api.restoreBackup).not.toHaveBeenCalled();
  });

  it('面板确认后上传恢复，展示结果并刷新备份列表', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.restoreBackup).mockResolvedValue(makeRestoreResult());
    vi.mocked(api.listBackups)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { name: 'pre-restore-20260101-010101-000.db', size: 1024, createdAt: '2026-01-01T01:01:01Z' },
      ]);
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    const file = selectFile(wrapper);
    await wrapper.find('button.restore-btn').trigger('click');
    await flushPromises();

    const panel = wrapper.find('.panel[role="dialog"]');
    expect(panel.exists()).toBe(true);
    await panel.findAll('button').find((b) => b.text() === '确认恢复')!.trigger('click');
    await flushPromises();

    expect(api.restoreBackup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.restoreBackup).mock.calls[0][0]).toBe(file);
    expect(wrapper.find('.backup-ok').text()).toContain('恢复');
    expect(api.listBackups).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.backup-item').text()).toContain('pre-restore-');
  });

  it('恢复成功后重新加载设置回填表单（I-4：防旧值覆盖新库）', async () => {
    vi.mocked(api.getSettings)
      .mockResolvedValueOnce(makeSettings({ reminder_hour: 8 })) // 恢复前的旧库
      .mockResolvedValue(makeSettings({ reminder_hour: 20 })); // 恢复后的新库
    vi.mocked(api.restoreBackup).mockResolvedValue(makeRestoreResult());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    expect((wrapper.find('#reminder-hour').element as HTMLSelectElement).value).toBe('8');

    selectFile(wrapper);
    await wrapper.find('button.restore-btn').trigger('click');
    await flushPromises();
    // 应用内面板确认（P2-11 两段式，替代原生 confirm）
    const panel = wrapper.find('.panel[role="dialog"]');
    expect(panel.exists()).toBe(true);
    await panel.findAll('button').find((b) => b.text() === '确认恢复')!.trigger('click');
    await flushPromises();

    // 恢复成功 → getSettings 再次被调用，表单回填新库设置
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect((wrapper.find('#reminder-hour').element as HTMLSelectElement).value).toBe('20');
  });

  it('未选择文件就点恢复 → 提示且不调用 API', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('button.restore-btn').trigger('click');
    await flushPromises();
    expect(api.restoreBackup).not.toHaveBeenCalled();
    expect(wrapper.find('.backup-error').text()).toContain('选择');
  });

  it('退出登录：清空本地口令并回登录页', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    setStoredToken('family-secret');
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('button.logout-btn').trigger('click');
    await flushPromises();

    expect(getStoredToken()).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');
  });
});

describe('SettingsView 数据概览（充实化）', () => {
  async function mountSettings() {
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('展示在库件数、类别数、备份文件数与最近备份时间', async () => {
    vi.mocked(api.listItems).mockResolvedValue([
      { id: 1 }, { id: 2 }, { id: 3 },
    ] as never);
    vi.mocked(api.listCategories).mockResolvedValue([
      { id: 1, name: '食品' }, { id: 2, name: '药品' },
    ] as never);
    vi.mocked(api.listBackups).mockResolvedValue([
      { name: 'stock-20261107-020000.db', size: 1024, createdAt: '2026-11-06T18:00:00.000Z' },
      { name: 'stock-20261106-020000.db', size: 1024, createdAt: '2026-11-05T18:00:00.000Z' },
    ]);
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const wrapper = await mountSettings();

    const cards = wrapper.findAll('.dv-card');
    expect(cards).toHaveLength(4);
    expect(cards[0].text()).toContain('3');
    expect(cards[1].text()).toContain('2');
    expect(cards[2].text()).toContain('2');
    expect(cards[3].text()).not.toBe('—');
  });

  it('概览数据加载失败不阻塞设置表单', async () => {
    vi.mocked(api.listItems).mockRejectedValue(new Error('overview down'));
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const wrapper = await mountSettings();
    expect(wrapper.find('form.settings-form').exists()).toBe(true);
    expect(wrapper.findAll('.dv-card')[0].text()).toContain('0');
  });
});

describe('SettingsView 备份文件名复制（铁律 10 反馈自熄）', () => {
  async function mountWithBackups() {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.listBackups).mockResolvedValue([
      { name: 'stock-20261108-020000.db', size: 1024, createdAt: '2026-11-07T18:00:00.000Z' },
    ]);
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('点击复制 → 写剪贴板、对勾出现；2.5s 后自动熄灭恢复为「复制」', async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      const wrapper = await mountWithBackups();

      const btn = wrapper.find('.copy-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toBe('复制');

      await btn.trigger('click');
      await flushPromises();
      expect(writeText).toHaveBeenCalledWith('stock-20261108-020000.db');
      expect(wrapper.find('.copy-btn').classes()).toContain('copied');
      expect(wrapper.find('.copy-btn').text()).toBe('✓');

      // 2.5s 自熄
      vi.advanceTimersByTime(2600);
      await flushPromises();
      expect(wrapper.find('.copy-btn').classes()).not.toContain('copied');
      expect(wrapper.find('.copy-btn').text()).toBe('复制');
    } finally {
      vi.useRealTimers();
    }
  });

  it('剪贴板不可用 → 不显示成功反馈', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const wrapper = await mountWithBackups();
    await wrapper.find('.copy-btn').trigger('click');
    await flushPromises();
    expect(wrapper.find('.copy-btn').classes()).not.toContain('copied');
    expect(wrapper.find('.copy-btn').text()).toBe('复制');
  });
});

describe('SettingsView 外观（主题切换）', () => {
  beforeEach(() => {
    localStorage.removeItem('home-stock-theme');
    document.documentElement.removeAttribute('data-theme');
  });

  async function mountSettingsAt() {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('默认跟随系统（生效浅色），三选 chips 渲染', async () => {
    const wrapper = await mountSettingsAt();
    const chips = wrapper.findAll('.theme-cards .theme-card');
    expect(chips.map((c) => c.text())).toEqual(['跟随系统', '浅色', '深色']);
    expect(chips[0].classes()).toContain('active');
    expect(wrapper.find('.theme-hint').text()).toContain('当前生效：浅色');
  });

  it('点「深色」→ data-theme=dark + 持久化；点「跟随系统」→ 存储清除', async () => {
    const wrapper = await mountSettingsAt();
    const chips = () => wrapper.findAll('.theme-cards .theme-card');

    await chips()[2].trigger('click');
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('home-stock-theme')).toBe('dark');
    expect(chips()[2].classes()).toContain('active');
    expect(wrapper.find('.theme-hint').text()).toContain('当前生效：深色');

    await chips()[0].trigger('click');
    await flushPromises();
    expect(localStorage.getItem('home-stock-theme')).toBe('system');
  });

  it('启动时已有持久化 dark → 卡片回显激活「深色」', async () => {
    localStorage.setItem('home-stock-theme', 'dark');
    const wrapper = await mountSettingsAt();
    expect(wrapper.findAll('.theme-cards .theme-card')[2].classes()).toContain('active');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('SettingsView 类别管理（D-2）', () => {
  function makeCategory(id: number, name: string) {
    return { id, name, sortOrder: id };
  }

  async function mountWithCategories() {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.listCategories).mockResolvedValue([
      makeCategory(1, '食品'),
      makeCategory(2, '药品'),
    ]);
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  it('渲染类别列表，添加成功后清空输入并追加', async () => {
    const wrapper = await mountWithCategories();
    expect(wrapper.findAll('.category-item')).toHaveLength(2);

    vi.mocked(api.createCategory).mockResolvedValue(makeCategory(3, '清洁用品'));
    await wrapper.find('.category-add input').setValue('清洁用品');
    await wrapper.find('.category-add').trigger('submit');
    await flushPromises();
    expect(api.createCategory).toHaveBeenCalledWith({ name: '清洁用品' });
    expect(wrapper.findAll('.category-item')).toHaveLength(3);
    expect((wrapper.find('.category-add input').element as HTMLInputElement).value).toBe('');
  });

  it('删除成功移除行；类别被占用（409）→ 行内报错不移除', async () => {
    const wrapper = await mountWithCategories();
    const rows = () => wrapper.findAll('.category-item');

    await rows()[0].findAll('button').find((b) => b.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(rows()).toHaveLength(1);

    const err = new Error('类别下仍有物品，禁止删除');
    err.name = 'ApiError';
    vi.mocked(api.deleteCategory).mockRejectedValue(err);
    await rows()[0].findAll('button').find((b) => b.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.form-error').text()).toContain('仍有物品');
    expect(rows()).toHaveLength(1);
  });

  it('改名：进入编辑态回显原名，保存调用 updateCategory', async () => {
    const wrapper = await mountWithCategories();
    vi.mocked(api.updateCategory).mockResolvedValue(makeCategory(1, '生鲜'));

    const row = wrapper.findAll('.category-item')[0];
    await row.findAll('button').find((b) => b.text() === '改名')!.trigger('click');
    const input = row.find('input[aria-label="修改类别名称"]');
    expect((input.element as HTMLInputElement).value).toBe('食品');
    await input.setValue('生鲜');
    await row.find('button[type="button"], button').trigger('click');
    await flushPromises();
    expect(api.updateCategory).toHaveBeenCalledWith(1, { name: '生鲜' });
    expect(wrapper.text()).toContain('生鲜');
  });
});

describe('SettingsView 分组标签页', () => {
  // happy-dom(vitest) 怪癖：getComputedStyle().display 返回空串，isVisible() 误判 —— 改断言内联 style（DOM 事实）
  const shown = (w: { attributes: (a: string) => string | undefined }) =>
    !(w.attributes('style') ?? '').includes('display: none');

  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  async function mountSettings() {
    const router = await makeRouter('/settings');
    const wrapper = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    return wrapper;
  }

  function chipOf(wrapper: ReturnType<typeof mount>, label: string) {
    return wrapper.findAll('.tab-chip').find((c) => c.text() === label)!;
  }

  it('默认外观 tab：点「通知」只显示通知区块，其余区块隐藏（IA 合并后 5 个 tab）', async () => {
    const wrapper = await mountSettings();
    expect(wrapper.findAll('.tab-chip')).toHaveLength(5);
    expect(shown(wrapper.find('#sec-appearance'))).toBe(true);
    expect(shown(wrapper.find('#sec-notify'))).toBe(false);
    expect(shown(wrapper.find('#sec-backup'))).toBe(false);

    await chipOf(wrapper, '通知').trigger('click');
    expect(shown(wrapper.find('#sec-notify'))).toBe(true);
    expect(shown(wrapper.find('#sec-appearance'))).toBe(false);
    expect(shown(wrapper.find('#sec-remind'))).toBe(false);
    expect(chipOf(wrapper, '通知').classes()).toContain('active');
    expect(chipOf(wrapper, '外观').classes()).not.toContain('active');
    // 三渠道子块 + 发送日志同屏
    expect(wrapper.find('#sec-inapp').exists()).toBe(true);
    expect(wrapper.find('#sec-email').exists()).toBe(true);
    expect(wrapper.find('#sec-wecom').exists()).toBe(true);
  });

  it('保存按钮只在含表单字段的 tab 显示（提醒/通知）', async () => {
    const wrapper = await mountSettings();
    const saveBtn = () => wrapper.find('form.settings-form button[type="submit"]');

    // 默认外观 tab：无需保存 → 按钮隐藏（v-show，元素仍在 DOM）
    expect(shown(saveBtn())).toBe(false);

    await chipOf(wrapper, '提醒').trigger('click');
    expect(shown(saveBtn())).toBe(true);
    await chipOf(wrapper, '通知').trigger('click');
    expect(shown(saveBtn())).toBe(true); // 通知 tab 含邮件/企微渠道字段
    await chipOf(wrapper, '备份与恢复').trigger('click');
    expect(shown(saveBtn())).toBe(false);
  });

  it('切换 tab 不丢失未保存的表单修改（v-show 保 DOM）', async () => {
    const wrapper = await mountSettings();
    await chipOf(wrapper, '通知').trigger('click');
    await wrapper.find('#email-pass').setValue('half-typed-secret');

    await chipOf(wrapper, '提醒').trigger('click');
    await chipOf(wrapper, '通知').trigger('click');
    expect((wrapper.find('#email-pass').element as HTMLInputElement).value).toBe('half-typed-secret');
  });

  it('tab 选中态记入 sessionStorage，重挂载后还原', async () => {
    const wrapper = await mountSettings();
    await chipOf(wrapper, '通知').trigger('click');

    const router = await makeRouter('/settings');
    const wrapper2 = mount(SettingsView, { global: { plugins: [router] } });
    await flushPromises();
    expect(shown(wrapper2.find('#sec-notify'))).toBe(true);
    expect(shown(wrapper2.find('#sec-appearance'))).toBe(false);
  });

  it('测试发送结果只渲染在对应渠道的子块内，不串显', async () => {
    vi.mocked(api.notifyTest).mockResolvedValue({ results: { email: { ok: true } } });
    const wrapper = await mountSettings();

    await wrapper.find('button[data-channel="email"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.test-result')).toHaveLength(1);
    expect(wrapper.find('#sec-email .test-result').text()).toContain('成功');
    expect(wrapper.find('#sec-wecom .test-result').exists()).toBe(false);
    expect(wrapper.find('#sec-inapp .test-result').exists()).toBe(false);
  });
});
