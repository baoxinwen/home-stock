/**
 * 双端视口冒烟（brief 交付物 5，覆盖 M9.2 + PC 仪表盘骨架）：
 * 登录 → 总览首页渲染 → 导航切换。mobile 375×667 与 desktop 1280×720 各跑一遍。
 * 仪表盘架构（2026-11-08 合并后）：desktop = 顶部导航 + 总览首页；mobile = 底部 tabbar（6 项）。
 * 从未登录状态开始（登录本身是被测步骤），与主链路 storageState 约定不同但同走真实登录页。
 */
import { expect, test } from '@playwright/test';
import { ACCESS_TOKEN, BASE_URL } from '../helpers/env';
import { shot } from '../helpers/ui';

// 冒烟从干净会话开始：显式空 storageState（undefined 不会覆盖项目级配置），登录流程全走真实 UI
test.use({ storageState: { cookies: [], origins: [] } });

test('登录 → 总览首页渲染 → 导航切换', async ({ page }) => {
  const isDesktop = test.info().project.name === 'desktop';

  // 未登录访问业务页 → 跳登录页（M9.2）
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('#access-token')).toBeVisible();

  // 输入口令一次后正常使用（M9.2 前端）→ 落在总览仪表盘
  await page.locator('#access-token').fill(ACCESS_TOKEN);
  await page.getByRole('button', { name: '进入' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(page.locator('h1.page-title')).toHaveText('总览');
  await expect(page.locator('.kpi-card')).toHaveCount(4);

  // 导航形态：desktop 顶部导航 5 项（通知收敛为铃铛，IA 轻量下拉）+ 当前项「总览」高亮 + 无底部 tab；
  // mobile 2026-11-12 M-13 方案A：顶栏铃铛（通知收口）+ tabbar 5 项，与 PC 心智一致
  if (isDesktop) {
    await expect(page.locator('nav.tabbar')).toBeHidden();
    await expect(page.locator('.topnav .topnav-item')).toHaveCount(5);
    await expect(page.locator('.topnav .topnav-item.router-link-active')).toHaveText(/总览/);
    await expect(page.locator('.topnav-add')).toBeVisible();
  } else {
    await expect(page.locator('.topnav')).toHaveCount(0);
    await expect(page.locator('.mobile-topbar .mobile-bell')).toBeVisible();
    await expect(page.locator('nav.tabbar')).toBeVisible();
    await expect(page.locator('nav.tabbar .tab-item')).toHaveCount(5);
  }
  await shot(page, 'smoke-overview');

  // 导航切换：库存（独立页）→ 清单 → 统计
  await page.getByRole('link', { name: '库存', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('库存');
  await page.getByRole('link', { name: '清单', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('购物清单');
  await page.getByRole('link', { name: '统计', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('统计');
  await shot(page, 'smoke-stats');
});

test('未携带口令访问 API 返回 401（M9.2 服务端）', async ({ request }) => {
  const res = await request.get('/api/items');
  expect(res.status()).toBe(401);
});
