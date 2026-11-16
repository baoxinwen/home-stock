/**
 * 提交按钮忙态保留可聚焦（评审 A-L3）：native disabled 使「点击提交」这一下
 * 就把焦点丢到 body——改为 aria-disabled + handler 守卫，按钮保持可聚焦、
 * 忙态视觉不变、重复点击被守卫拦截。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({
      default_remind_days: 3,
      reminder_hour: 8,
      auto_archive_expired: 1,
      email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
      wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    })),
    listNotificationLogs: vi.fn(async () => []),
    listBackups: vi.fn(async () => []),
    findItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    createItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    createShoppingItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    updateSettings: vi.fn(async () => ({
      default_remind_days: 3,
      reminder_hour: 8,
      auto_archive_expired: 1,
      email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
      wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    })),
    notifyTest: vi.fn(async () => ({ results: { email: { ok: true } } })),
    router: vi.fn(),
  },
}));

import { api } from '../api';
import { router } from '../router';
import LoginView from './LoginView.vue';
import ItemFormView from './ItemFormView.vue';
import ShoppingView from './ShoppingView.vue';
import SettingsView from './SettingsView.vue';

/** 永不落定的 Promise：挂起期间断言忙态 */
const pending = <T,>(): Promise<T> => new Promise<T>(() => {});

function assertBusyFocusable(btn: HTMLButtonElement): void {
  // 忙态：不再 native disabled（不丢焦点），改标 aria-disabled
  expect(btn.disabled).toBe(false);
  expect(btn.getAttribute('aria-disabled')).toBe('true');
}

describe('提交按钮忙态保留可聚焦（A-L3）', () => {
  it('登录：验证挂起中按钮可聚焦 + aria-disabled', async () => {
    vi.mocked(api.getSettings).mockImplementation(pending);
    const wrapper = mount(LoginView, { attachTo: document.body });
    await flushPromises();
    await wrapper.find('#access-token').setValue('any-token');
    await wrapper.find('form.login-form').trigger('submit');
    await nextTick();
    assertBusyFocusable(wrapper.find('.primary-btn').element as HTMLButtonElement);
    wrapper.unmount();
  });

  it('记一笔：保存挂起中主按钮可聚焦 + aria-disabled', async () => {
    vi.mocked(api.createItem).mockImplementation(pending);
    const wrapper = mount(ItemFormView, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    await wrapper.find('input[placeholder="如：鲜牛奶"]').setValue('牛奶E2E');
    // 过期方式默认 direct，需填过期日期才能过校验（购买日期是第 1 个 date 输入）
    await wrapper.findAll('input[type="date"]')[1].setValue('2026-12-01');
    await wrapper.find('form.form').trigger('submit');
    await nextTick();
    assertBusyFocusable(wrapper.find('.btn-primary').element as HTMLButtonElement);
    wrapper.unmount();
  });

  it('清单添加：挂起中按钮可聚焦 + aria-disabled', async () => {
    vi.mocked(api.createShoppingItem).mockImplementation(pending);
    const wrapper = mount(ShoppingView, { attachTo: document.body });
    await flushPromises();
    await wrapper.find('.add-name').setValue('测试品');
    await wrapper.find('form.add-form').trigger('submit');
    await nextTick();
    assertBusyFocusable(wrapper.find('.add-submit').element as HTMLButtonElement);
    wrapper.unmount();
  });

  it('设置保存：挂起中按钮可聚焦 + aria-disabled（重复提交被守卫拦截）', async () => {
    vi.mocked(api.updateSettings).mockImplementation(pending);
    const wrapper = mount(SettingsView, { global: { plugins: [router], stubs: { teleport: true } }, attachTo: document.body });
    await flushPromises();
    await wrapper.findAll('.tab-chip').find((c) => c.text() === '提醒')!.trigger('click');
    await wrapper.find('form.settings-form').trigger('submit');
    await nextTick();
    assertBusyFocusable(wrapper.find('form.settings-form button[type="submit"]').element as HTMLButtonElement);
    // 再触发一次提交：挂起中不得重复发请求
    const calls = vi.mocked(api.updateSettings).mock.calls.length;
    await wrapper.find('form.settings-form').trigger('submit');
    expect(vi.mocked(api.updateSettings).mock.calls.length).toBe(calls);
    wrapper.unmount();
  });

  it('渠道测试发送：挂起中按钮可聚焦 + aria-disabled', async () => {
    vi.mocked(api.notifyTest).mockImplementation(pending);
    const wrapper = mount(SettingsView, { global: { plugins: [router], stubs: { teleport: true } } });
    await flushPromises();
    const btn = wrapper.find('[data-channel="email"]');
    await btn.trigger('click');
    await nextTick();
    assertBusyFocusable(btn.element as HTMLButtonElement);
    wrapper.unmount();
  });
});
