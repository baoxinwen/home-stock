/**
 * 表单校验错误关联与移焦（评审 A-M6）：提交失败时
 * - 出错字段标 aria-invalid 并经 aria-describedby 关联错误文案
 * - 焦点移到首个无效字段（SR 听到错误后无需自行寻找）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { router } from '../router';

vi.mock('../api', () => ({
  api: {
    listItems: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({
      default_remind_days: 3,
      reminder_hour: 8,
      auto_archive_expired: 1,
      email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
      wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    })),
    updateSettings: vi.fn(async () => ({
      reminder_hour: 8,
      default_remind_days: 3,
      auto_archive_expired: 1,
      email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
      wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
    })),
    listNotificationLogs: vi.fn(async () => []),
    listBackups: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
    createShoppingItem: vi.fn(async () => ({})),
    findItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    createItem: vi.fn(async () => {
      throw new Error('not implemented');
    }),
  },
}));

import SettingsView from './SettingsView.vue';
import ShoppingView from './ShoppingView.vue';
import ItemFormView from './ItemFormView.vue';

describe('设置表单校验关联（A-M6）', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
  });

  it('提醒阈值非法：字段标 aria-invalid + 关联错误 + 焦点移入', async () => {
    const wrapper = mount(SettingsView, { global: { plugins: [router], stubs: { teleport: true } }, attachTo: document.body });
    await flushPromises();
    // 切到「提醒」tab（保存按钮只在该 tab 显示）
    await wrapper.findAll('.tab-chip').find((c) => c.text() === '提醒')!.trigger('click');
    const days = wrapper.find('#default-remind-days');
    await days.setValue('0');
    await wrapper.find('form.settings-form').trigger('submit');
    await flushPromises();
    expect(days.attributes('aria-invalid')).toBe('true');
    const describedby = days.attributes('aria-describedby');
    expect(describedby).toBeTruthy();
    expect(wrapper.find(`#${describedby}`).text()).toContain('提醒阈值');
    expect(document.activeElement).toBe(days.element);
    wrapper.unmount();
  });
});

describe('记一笔表单校验关联（A-M6）', () => {
  it('空名称提交：名称字段标 aria-invalid 并聚焦', async () => {
    const wrapper = mount(ItemFormView, { global: { plugins: [router], stubs: { teleport: true } }, attachTo: document.body });
    await flushPromises();
    const name = wrapper.find('input[placeholder="如：鲜牛奶"]');
    await wrapper.find('form.form button[type="submit"]').trigger('submit');
    await flushPromises();
    expect(name.attributes('aria-invalid')).toBe('true');
    expect(wrapper.find('.error-text').text()).toContain('名称必填');
    expect(document.activeElement).toBe(name.element);
    wrapper.unmount();
  });
});

describe('清单添加校验关联（A-M6）', () => {
  it('负数单价：单价字段标 aria-invalid 并聚焦', async () => {
    const wrapper = mount(ShoppingView, { attachTo: document.body });
    await flushPromises();
    await wrapper.find('.add-name').setValue('测试品');
    await wrapper.find('.add-price').setValue('-1');
    await wrapper.find('form.add-form').trigger('submit');
    await flushPromises();
    const price = wrapper.find('.add-price');
    expect(price.attributes('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(price.element);
    wrapper.unmount();
  });
});
