/**
 * 路由标题（评审 A-H3 / WCAG 2.4.2 Page Titled）：
 * 每条路由必须声明 meta.title，afterEach 据此更新 document.title——
 * 此前全站共用一个标题，浏览器标签页/历史/收藏与 SR 导航均无法区分页面。
 */
import { describe, expect, it } from 'vitest';
import { documentTitleFor, router } from './index';

describe('路由 document.title', () => {
  it('除重定向兜底外每条路由都声明 meta.title', () => {
    for (const route of router.getRoutes()) {
      if (!route.components && !route.redirect) continue;
      if (route.redirect && !route.components) continue; // catchall 重定向
      expect(route.meta.title, `路由 ${route.path} 缺 meta.title`).toBeTruthy();
      expect(typeof route.meta.title).toBe('string');
    }
  });

  it('documentTitleFor：有 title 拼「页名 · 家庭库存助手」，无 title 回退站名', () => {
    expect(documentTitleFor({ title: '统计' })).toBe('统计 · 家庭库存助手');
    expect(documentTitleFor({})).toBe('家庭库存助手');
    expect(documentTitleFor({ title: '' })).toBe('家庭库存助手');
  });
});
