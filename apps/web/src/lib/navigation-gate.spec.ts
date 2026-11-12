import { describe, expect, it } from 'vitest';
import { shouldShowNav } from './navigation-gate';

describe('shouldShowNav（主导航渲染门控）', () => {
  it('初始导航未完成（name 为 undefined）→ 不渲染', () => {
    expect(shouldShowNav(undefined)).toBe(false);
  });

  it('登录页 → 不渲染', () => {
    expect(shouldShowNav('login')).toBe(false);
  });

  it('业务页 → 渲染', () => {
    expect(shouldShowNav('inventory')).toBe(true);
    expect(shouldShowNav('stats')).toBe(true);
    expect(shouldShowNav(Symbol('named'))).toBe(true);
  });
});
