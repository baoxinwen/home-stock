/**
 * 用例公共助手：真实 UI 登录、截图落盘、API 直连、相对日期。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { ReminderRunResult } from '@home-stock/shared';
import { ACCESS_TOKEN, BASE_URL, SHOTS_DIR } from './env';

/** M9.2 前端链路：未登录访问业务页 → /login → 输口令 → 进入总览（仪表盘架构：`/` 为总览首页） */
export async function loginViaUi(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.locator('#access-token').fill(ACCESS_TOKEN);
  await page.getByRole('button', { name: '进入' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(page.locator('h1.page-title')).toHaveText('总览');
}

/** 截图落盘 .superpowers-shots/（brief 交付物 7）；文件名带项目前缀避免双视口覆盖。
 * animations:'disabled' 让 .enter 入场动画（600ms stagger）瞬间完成，避免截到 opacity:0 帧。 */
export async function shot(page: Page, name: string): Promise<void> {
  const prefix = test.info().project.name;
  await page.screenshot({
    path: resolve(SHOTS_DIR, `${prefix}-${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

/** 手动触发提醒扫描（POST /api/reminders/run，X-Access-Token 头） */
export async function runReminders(request: APIRequestContext): Promise<ReminderRunResult> {
  const res = await request.post('/api/reminders/run', {
    headers: { 'X-Access-Token': ACCESS_TOKEN },
    data: {},
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: ReminderRunResult };
  return body.data;
}

/** 带 X-Access-Token 的 GET（断言清单项状态等服务端状态用） */
export async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path, { headers: { 'X-Access-Token': ACCESS_TOKEN } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export interface MinimalShoppingItem {
  id: number;
  name: string;
  status: 'pending' | 'done' | 'converted';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 今天的本地日期 YYYY-MM-DD */
export function today(): string {
  return isoDate(new Date());
}

/** 明天（录入临期物品用，避免脆弱的绝对日期断言） */
export function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

/** 昨天（录入过期物品用） */
export function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}
