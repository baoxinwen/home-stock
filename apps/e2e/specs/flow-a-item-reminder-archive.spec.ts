/**
 * 系统测试 A「录入→提醒→归档」（brief 交付物 3，覆盖 M1.1/M3.1/M3.3/M4.1/M7.3/M10.1 抽查）：
 * 真实浏览器 + 真实 server（每次跑测全新库）。
 * 主链路仅在 desktop 项目运行；双端视口冒烟见 smoke.spec.ts。
 */
import { expect, test } from '@playwright/test';
import { runReminders, shot, tomorrow, yesterday } from '../helpers/ui';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', '主链路系统测试仅在 desktop 项目运行');
});

test('录入→临期提醒→去重→过期自动归档→浪费统计', async ({ page, request }) => {
  // ---- 1. UI 录入物品（M1.1）：过期日 = 明天，其余字段合理 ----
  // 仪表盘架构：`/` 为总览，库存独立 /inventory（desktop-only，页头「＋ 记一笔」）
  await page.goto('/inventory');
  await page.getByRole('main').getByRole('button', { name: '＋ 记一笔' }).click();
  await expect(page.locator('h1.page-title')).toHaveText('记一笔');
  await page.locator('input[placeholder="如：鲜牛奶"]').fill('牛奶E2E');
  await page.getByLabel('数量').fill('2');
  await page.getByLabel('单位').fill('盒');
  await page.getByLabel('单价（元）').fill('12.5');
  await page.getByLabel('过期日期').fill(tomorrow());
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('物品详情');
  await expect(page.locator('.item-name')).toHaveText('牛奶E2E');
  await shot(page, 'flow-a-item-created');

  // ---- 2. 以 X-Access-Token 触发提醒扫描 → 临期提醒（M7.3 应用内渠道） ----
  const first = await runReminders(request);
  expect(first.notified).toBe(1);

  // 桌面通知入口（轻量下拉）：顶栏铃铛弹出面板，深度处理经「查看全部通知」去全页
  await page.getByRole('button', { name: /通知/ }).click(); // 铃铛 aria-label「通知（N 条未读）」
  const notifPop = page.locator('.notif-pop');
  await expect(notifPop).toBeVisible();
  // 面板行是轻量展示（无类型徽章）：名称 + 数量 + 天数徽章
  await expect(notifPop.locator('.notif-pop-row').first()).toContainText('牛奶E2E');
  await expect(notifPop.locator('.notif-pop-row').first()).toContainText('剩 1 天');
  await expect(notifPop.locator('.notif-pop-count')).toContainText('未读 1');
  await shot(page, 'flow-a-notifications');

  // M7.3→0004：面板「全部完成」（done ⊃ 已读），铃铛徽章即时消失
  await notifPop.getByRole('button', { name: '全部完成' }).click();
  await expect(notifPop.locator('.notif-pop-count')).toContainText('未读 0');
  await expect(page.locator('.bell-count')).toHaveCount(0);

  // ---- 3. 再次 run → 不重复提醒（M3.1/M3.3：每物品每类型终身一次） ----
  const second = await runReminders(request);
  expect(second.notified).toBe(0);
  // 深度处理去全页（路由变化自动收起面板）：仍只有 1 条通知，无新增（0004：已在「已完成」视图）
  await notifPop.getByRole('link', { name: '查看全部通知 →' }).click();
  await expect(page.locator('h1.page-title')).toHaveText('通知');
  await expect(notifPop).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /已完成/ }).click();
  await expect(page.locator('.notification-item')).toHaveCount(1);
  await shot(page, 'flow-a-notifications-dedup');

  // ---- 4. 录入过期物品（过期日 = 昨天）→ run → 自动归档「过期丢弃」（M4.1） ----
  await page.getByRole('link', { name: '库存', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '＋ 记一笔' }).click();
  await expect(page.locator('h1.page-title')).toHaveText('记一笔');
  await page.locator('input[placeholder="如：鲜牛奶"]').fill('酸奶E2E');
  await page.getByLabel('数量').fill('1');
  await page.getByLabel('单位').fill('杯');
  await page.getByLabel('单价（元）').fill('9.9');
  await page.getByLabel('过期日期').fill(yesterday());
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('物品详情');

  const third = await runReminders(request);
  expect(third.notified).toBe(1); // 过期日已过 → 「已过期」提醒
  expect(third.archived).toBe(1); // 默认开启自动归档 → expired_discarded

  // ---- 5. 主列表消失，临期物品仍在且带「临期」状态（desktop 为表格宽行） ----
  await page.getByRole('link', { name: '库存', exact: true }).click();
  await expect(page.locator('.inv-table')).not.toContainText('酸奶E2E');
  const milk = page.locator('.inv-row', { hasText: '牛奶E2E' });
  await expect(milk).toContainText('临期');
  await shot(page, 'flow-a-inventory-after-archive');

  // ---- 5.5 仪表盘架构：点行在抽屉内查看详情并完成归档 ----
  await milk.locator('.inv-name-btn').click();
  const drawer = page.locator('.drawer-panel');
  await expect(drawer.locator('.item-name')).toHaveText('牛奶E2E');
  await shot(page, 'flow-a-detail');
  await drawer.getByRole('button', { name: '归档' }).click();
  await drawer.locator('.option').first().click(); // 用完
  // 归档动作达成（抽屉内状态翻转为已归档），关闭抽屉回列表
  await expect(drawer).toContainText('已归档 · 用完');
  await drawer.locator('.drawer-close').click();
  await expect(drawer).toHaveCount(0);
  // 全部物品已归档 → 库存清空走空态分支（.inv-table 不渲染，不能对不存在元素断言）
  await expect(page.locator('.inv-table')).toHaveCount(0);
  await expect(page.locator('.inventory')).toContainText('还没有物品');
  await shot(page, 'flow-a-archived');

  // ---- 6. 归档记录页可见（M1.6 archived_reason 保留；含面板内归档的记录） ----
  await page.getByRole('link', { name: '归档记录' }).click();
  await expect(page.locator('h1.page-title')).toHaveText('归档记录');
  const archivedCard = page.locator('.archive-card', { hasText: '酸奶E2E' });
  await expect(archivedCard).toContainText('过期丢弃');
  await expect(page.locator('.archive-card', { hasText: '牛奶E2E' })).toContainText('用完');
  await shot(page, 'flow-a-archive');

  // ---- 7. 统计页浪费件数/金额包含该物品（M10.1 抽查；用完不计浪费——本库无 used_up 记录） ----
  await page.getByRole('link', { name: '统计', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('统计');
  await expect(page.locator('.overview-count')).toHaveText(/1/);
  await expect(page.locator('.overview-amount')).toHaveText(/¥9\.90/);
  // M10.2 抽查：按类别分布包含该条（未分类）
  await expect(page.locator('.category-row').first()).toContainText('未分类');
  await shot(page, 'flow-a-stats');
});
