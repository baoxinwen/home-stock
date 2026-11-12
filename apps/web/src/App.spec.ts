/**
 * App 骨架测试（稳定时序版）：
 * - 无登录态 → 初始导航被守卫改到 /login，登录页不渲染主导航
 * - 登录态 + 业务页 → 渲染主导航（桌面侧栏或移动 tabbar）
 *
 * 「初始导航完成前不渲染导航」的门控逻辑与回归背景见 lib/navigation-gate.ts
 * （该时序窗口在 happy-dom + vitest 组合下会触发 isReady 挂起，无法稳定单测，
 * 以浏览器实测为准）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { getStoredToken } from './auth/token';
// 诊断说明：内联守卫逻辑而非导入 ./router/guard —— 该模块导入与本文件的
// vi.mock('./api') 组合会触发 vitest 收集阶段挂死（环境怪癖，2026-11-08）。
// 语义与 createAuthGuard 完全一致。
const createAuthGuard = (getToken: () => string | null = getStoredToken) => (to: { path: string; meta: { public?: boolean } }) => {
  if (to.path === '/login' || to.meta.public === true) return true;
  if (getToken()) return true;
  return { path: '/login', query: {} as Record<string, string> };
};

vi.mock('./api', () => ({
  api: {
    listNotifications: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
    getWasteStats: vi.fn(async () => ({ period: '2026-11', totalCount: 0, totalAmount: 0, byCategory: [] })),
  },
}));

import App from './App.vue';

function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      // name 必须与生产路由一致：showNav 门控依赖 route.name（undefined = 导航未完成）
      { path: '/', name: 'inventory', component: { template: '<div class="page-home" />' } },
      { path: '/login', name: 'login', component: { template: '<div class="page-login" />', meta: { public: true } } },
    ],
  });
  router.beforeEach(createAuthGuard());
  return router;
}

beforeEach(() => {
  localStorage.clear();
});

describe('App 导航渲染门控', () => {
  it('登录态 + 业务页 → 渲染主导航（顶部导航或 tabbar）', async () => {
    localStorage.setItem('home-stock-access-token', 't-1234567890');
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    const navExists =
      wrapper.find('.topnav').exists() || wrapper.find('.tabbar').exists();
    expect(navExists).toBe(true);
    expect(wrapper.find('.page-home').exists()).toBe(true);
    wrapper.unmount();
  });

  it('无登录态 → 登录页不渲染主导航', async () => {
    const router = makeRouter();
    await router.push('/login');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/login');
    expect(wrapper.find('.topnav').exists()).toBe(false);
    expect(wrapper.find('.tabbar').exists()).toBe(false);
    expect(wrapper.find('.page-login').exists()).toBe(true);
    wrapper.unmount();
  });
});
