/**
 * Task8 RED — 登录页（M9.2）：口令校验、正确口令进入应用、401 提示且不进入。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ApiError } from '../api/api';
import { getStoredToken } from '../auth/token';

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(),
  },
}));

import { api } from '../api';
import LoginView from './LoginView.vue';

function makeSettings() {
  return {
    default_remind_days: 3,
    reminder_hour: 8,
    auto_archive_expired: 1,
    email: { enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null },
    wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
  };
}

async function makeRouter(path = '/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/settings', component: { template: '<div>settings</div>' } },
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

describe('LoginView', () => {
  it('空口令提交 → 显示校验错误且不发请求', async () => {
    const router = await makeRouter();
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    await wrapper.find('form.login-form').trigger('submit');
    await flushPromises();

    expect(api.getSettings).not.toHaveBeenCalled();
    expect(wrapper.find('.form-error').text()).toContain('口令');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('正确口令 → 存 localStorage 并进入库存页', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter();
    const wrapper = mount(LoginView, { global: { plugins: [router] } });

    await wrapper.find('#access-token').setValue('family-secret');
    await wrapper.find('form.login-form').trigger('submit');
    await flushPromises();

    expect(api.getSettings).toHaveBeenCalledTimes(1);
    expect(getStoredToken()).toBe('family-secret');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('支持 ?redirect= 回到登录前页面', async () => {
    vi.mocked(api.getSettings).mockResolvedValue(makeSettings());
    const router = await makeRouter('/login?redirect=/settings');
    const wrapper = mount(LoginView, { global: { plugins: [router] } });

    await wrapper.find('#access-token').setValue('family-secret');
    await wrapper.find('form.login-form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/settings');
  });

  it('口令错误（401）→ 清空本地口令、提示错误、停留登录页', async () => {
    vi.mocked(api.getSettings).mockRejectedValue(
      new ApiError('UNAUTHORIZED', '访问口令缺失或错误'),
    );
    const router = await makeRouter();
    const wrapper = mount(LoginView, { global: { plugins: [router] } });

    await wrapper.find('#access-token').setValue('wrong');
    await wrapper.find('form.login-form').trigger('submit');
    await flushPromises();

    expect(getStoredToken()).toBeNull();
    expect(wrapper.find('.form-error').text()).toContain('口令');
    expect(router.currentRoute.value.path).toBe('/login');
  });
});
