/**
 * AppTopNav 单测（PC 顶部导航）：五项目的地导航、铃铛通知入口、待购徽章、记一笔跳转。
 * IA 调整（轻量下拉）：通知不再是一级导航项，收敛为右上角铃铛（面板逻辑见 NotificationPopover.spec）。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router';

vi.mock('../api', () => ({
  api: {
    listNotifications: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    listShoppingItems: vi.fn(async () => []),
  },
}));

import { api } from '../api';
import AppTopNav from './AppTopNav.vue';

async function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/inventory', component: { template: '<div />' } },
      { path: '/items/new', component: { template: '<div />' } },
      { path: '/notifications', component: { template: '<div />' } },
      { path: '/list', component: { template: '<div />' } },
      { path: '/stats', component: { template: '<div />' } },
      { path: '/settings', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  return router;
}

describe('AppTopNav', () => {
  it('渲染五项目的地导航且指向正确（通知不占导航位）', async () => {
    const router = await makeRouter();
    const wrapper = mount(AppTopNav, { global: { plugins: [router] } });
    await flushPromises();

    const routerLinks = wrapper.findAllComponents(RouterLink);
    expect(routerLinks.map((l) => l.props('to'))).toEqual([
      '/',
      '/inventory',
      '/list',
      '/stats',
      '/settings',
    ]);
    expect(wrapper.findAll('.topnav-item').map((l) => l.text().replace(/\d+/g, '').trim())).toEqual([
      '总览',
      '库存',
      '清单',
      '统计',
      '设置',
    ]);
  });

  it('铃铛显示未读徽章；点击弹出不关闭（面板逻辑在 NotificationPopover.spec）', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      { id: 1, itemId: 1, itemName: null, type: 'expired', sentDate: '2026-11-08', channels: null, read: 0, createdAt: null },
    ] as never);
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      { id: 1, name: '酱油', quantity: 1, unit: '瓶', price: null, categoryId: null, status: 'pending' },
      { id: 2, name: '纸巾', quantity: 1, unit: null, price: null, categoryId: null, status: 'pending' },
    ] as never);
    const router = await makeRouter();
    const wrapper = mount(AppTopNav, { global: { plugins: [router] } });
    await flushPromises();

    const bell = wrapper.find('.bell-btn');
    expect(bell.exists()).toBe(true);
    expect(bell.attributes('aria-label')).toContain('通知');
    expect(wrapper.find('.bell-count').text()).toBe('1');

    // 点击铃铛 → aria-expanded 翻转（面板渲染是 NotificationPopover 的职责）
    await bell.trigger('click');
    expect(bell.attributes('aria-expanded')).toBe('true');
  });

  it('待购徽章显示在清单项上，零值不显示', async () => {
    vi.mocked(api.listShoppingItems).mockResolvedValue([
      { id: 1, name: '酱油', quantity: 1, unit: '瓶', price: null, categoryId: null, status: 'pending' },
      { id: 2, name: '纸巾', quantity: 1, unit: null, price: null, categoryId: null, status: 'pending' },
    ] as never);
    const router = await makeRouter();
    const wrapper = mount(AppTopNav, { global: { plugins: [router] } });
    await flushPromises();

    const badges = wrapper.findAll('.topnav-badge');
    expect(badges.map((b) => b.text())).toEqual(['2']);
    expect(badges[0].classes()).toContain('topnav-badge-blue');

    vi.mocked(api.listShoppingItems).mockResolvedValue([] as never);
    const empty = mount(AppTopNav, { global: { plugins: [router] } });
    await flushPromises();
    expect(empty.findAll('.topnav-badge')).toHaveLength(0);
  });

  it('记一笔 → 跳转 /items/new', async () => {
    const router = await makeRouter();
    const wrapper = mount(AppTopNav, { global: { plugins: [router] } });
    await flushPromises();
    await wrapper.find('.topnav-add').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/items/new');
  });
});
