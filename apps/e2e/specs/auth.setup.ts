/**
 * 登录态 setup（brief 交付物 2）：每个用例需要登录的走真实 UI 登录页输口令，
 * 主链路用例经 storageState 复用本次登录；冒烟用例显式从登录页走全流程。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup } from '@playwright/test';
import { E2E_AUTH_STATE_FILE } from '../helpers/env';
import { loginViaUi } from '../helpers/ui';

setup('通过真实 UI 登录页输口令并保存登录态', async ({ page }) => {
  await loginViaUi(page);
  mkdirSync(dirname(E2E_AUTH_STATE_FILE), { recursive: true });
  await page.context().storageState({ path: E2E_AUTH_STATE_FILE });
});
