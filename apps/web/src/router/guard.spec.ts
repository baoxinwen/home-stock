/**
 * Task8 RED — 路由守卫：未登录访问业务页 → /login（带 redirect），登录页与已登录放行。
 * 2026-11-08 追加：path 判据回归（vue-router 4.6.4 meta 污染时仍正确放行 /login）。
 */
import { describe, expect, it } from 'vitest';
import { createAuthGuard } from './guard';

function to(fullPath: string, isPublic = false) {
  return { fullPath, path: fullPath, meta: isPublic ? { public: true } : {} };
}

describe('createAuthGuard', () => {
  it('未登录访问 /settings → 跳登录页并带 redirect', () => {
    const guard = createAuthGuard(() => null);
    expect(guard(to('/settings'))).toEqual({ path: '/login', query: { redirect: '/settings' } });
  });

  it('未登录访问根路径 → 跳登录页（不带冗余 redirect）', () => {
    const guard = createAuthGuard(() => null);
    expect(guard(to('/'))).toEqual({ path: '/login', query: {} });
  });

  it('登录页本身放行', () => {
    const guard = createAuthGuard(() => null);
    expect(guard(to('/login', true))).toBe(true);
  });

  it('已登录放行', () => {
    const guard = createAuthGuard(() => 'tok');
    expect(guard(to('/settings'))).toBe(true);
  });

  it('meta 被污染（public 字段丢失）时 path 判据仍放行 /login（vue-router 4.6.4 规避）', () => {
    const guard = createAuthGuard(() => null);
    // vue-router 4.6.4 meta 污染：to.meta 归一化为 {}，public 字段消失
    expect(guard(to('/login', false))).toBe(true);
  });

  it('meta 被污染时业务页仍正常重定向（不受副作用影响）', () => {
    const guard = createAuthGuard(() => null);
    expect(guard(to('/stats'))).toEqual({ path: '/login', query: { redirect: '/stats' } });
  });
});
