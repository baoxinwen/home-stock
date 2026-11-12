/**
 * Task8 Fix Round 1 — 401 跳登录时保留 redirect，登录后可回跳原页面。
 */
import { describe, expect, it } from 'vitest';
import { loginRedirectUrl } from './redirect';

describe('loginRedirectUrl', () => {
  it('业务页 → 带 redirect 参数（含 query 一并保留）', () => {
    expect(loginRedirectUrl('/settings', '?tab=1')).toBe(
      '/login?redirect=%2Fsettings%3Ftab%3D1',
    );
    expect(loginRedirectUrl('/items/3')).toBe('/login?redirect=%2Fitems%2F3');
  });

  it('根路径 → 不产生冗余 redirect', () => {
    expect(loginRedirectUrl('/')).toBe('/login');
    expect(loginRedirectUrl('', '')).toBe('/login');
  });

  it('已经在登录页 → 不自我嵌套 redirect', () => {
    expect(loginRedirectUrl('/login')).toBe('/login');
    expect(loginRedirectUrl('/login', '?redirect=%2Fsettings')).toBe('/login');
  });
});
