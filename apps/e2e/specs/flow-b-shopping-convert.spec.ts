/**
 * 系统测试 B「清单→转库存」（brief 交付物 4，覆盖 M5.1/M5.2/M5.3，M3.4 旁证）：
 * 添加 → 勾选完成 → 转为库存 → 断言库存新物品带「待补过期日」、清单项 converted、
 * 清空已转换生效；无过期日物品不产生任何提醒。
 * 主链路仅在 desktop 项目运行；双端视口冒烟见 smoke.spec.ts。
 */
import { expect, test } from '@playwright/test';
import { apiGet, runReminders, shot, type MinimalShoppingItem } from '../helpers/ui';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop', '主链路系统测试仅在 desktop 项目运行');
});

test('清单添加→勾选→转库存→待补过期日→清空已转换', async ({ page, request }) => {
  // ---- 1. 清单添加（M5.1）：名称/数量/单价/单位 ----
  await page.goto('/list');
  await expect(page.locator('h1.page-title')).toHaveText('购物清单');
  await page.locator('.add-name').fill('纸巾E2E');
  await page.locator('.add-quantity').fill('2');
  await page.locator('.add-unit').fill('包');
  await page.locator('.add-price').fill('8.5');
  await page.getByRole('button', { name: '添加' }).click();
  const pending = page.locator('.shopping-item.pending', { hasText: '纸巾E2E' });
  await expect(pending).toBeVisible();
  await expect(pending.locator('.qty-edit')).toHaveValue('2');
  await expect(page.locator('.pending-count')).toContainText('1 项待购');

  // ---- 2. 勾选完成：pending → done（2026-11-11 L-2：已完成区默认折叠，先展开） ----
  await pending.getByRole('button', { name: '勾选完成 纸巾E2E' }).click();
  await page.locator('.done-section .section-toggle').click();
  const done = page.locator('.shopping-item.done', { hasText: '纸巾E2E' });
  await expect(done).toBeVisible();
  await expect(done).toContainText('转为库存');
  await shot(page, 'flow-b-done');

  // ---- 3. 转为库存（M5.2）：D-3 成功提示带「去补填过期日」直达链接 ----
  await done.getByRole('button', { name: '转为库存' }).click();
  await expect(page.getByText('已转入库存')).toBeVisible();
  await expect(page.getByRole('link', { name: '去补填过期日 →' })).toBeVisible();
  // converted 项不在主视图展示（M5.2 语义：标记完成并保留），状态走 API 断言
  const list = await apiGet<MinimalShoppingItem[]>(request, '/api/shopping-items');
  expect(list.find((s) => s.name === '纸巾E2E')?.status).toBe('converted');

  // ---- 4. 库存出现新物品且带「待补过期日」提示（M5.3；desktop 表格行） ----
  await page.getByRole('link', { name: '库存', exact: true }).click();
  const row = page.locator('.inv-row', { hasText: '纸巾E2E' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('待补过期日');
  await shot(page, 'flow-b-inventory-needs-expiry');

  // ---- 5. 点行在抽屉内查看详情：无过期日 → 长期存储品语义（M3.4） ----
  await row.locator('.inv-name-btn').click();
  const drawer = page.locator('.drawer-panel');
  await expect(drawer.locator('.item-name')).toHaveText('纸巾E2E');
  await expect(drawer.locator('.badge').first()).toContainText('长期');
  await shot(page, 'flow-b-detail');
  await drawer.locator('.drawer-close').click();
  await expect(drawer).toHaveCount(0);

  // 无过期日物品不参与临期提醒（M3.4/M5.3）：扫描无新通知
  const run = await runReminders(request);
  expect(run.notified).toBe(0);
  expect(run.archived).toBe(0);

  // ---- 6. M2.1 抽查：搜索框输入名称，结果过滤正确 ----
  await page.getByRole('link', { name: '库存', exact: true }).click();
  await page.locator('.search-box').fill('纸巾E2E');
  await expect(page.locator('.inv-row')).toHaveCount(1);
  await expect(page.locator('.inv-row')).toContainText('纸巾E2E');

  // ---- 7. 清空已转换（M5.2 可手动清空）：二次确认后生效 ----
  await page.getByRole('link', { name: '清单', exact: true }).click();
  await expect(page.locator('h1.page-title')).toHaveText('购物清单');
  await page.getByRole('button', { name: '清空已转换' }).click();
  await expect(page.getByRole('button', { name: '确认清空已转换？' })).toBeVisible();
  await page.getByRole('button', { name: '确认清空已转换？' }).click();
  await expect(page.locator('.clear-converted')).toHaveCount(0);
  const cleared = await apiGet<MinimalShoppingItem[]>(request, '/api/shopping-items');
  expect(cleared).toHaveLength(0);
  await shot(page, 'flow-b-cleared');
});
