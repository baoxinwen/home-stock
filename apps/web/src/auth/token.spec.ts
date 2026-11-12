/**
 * Task8 RED — 访问口令本地持久化（M9.2）：登录一次存 localStorage，退出/401 清理。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_STORAGE_KEY, clearStoredToken, getStoredToken, setStoredToken } from './token';

describe('访问口令本地存储', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未登录时返回 null', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('设置后可读取，trim 掉首尾空白', () => {
    setStoredToken('  family-secret  ');
    expect(getStoredToken()).toBe('family-secret');
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('family-secret');
  });

  it('空口令不会写入（避免带着空 token 请求）', () => {
    setStoredToken('   ');
    expect(getStoredToken()).toBeNull();
  });

  it('clear 后返回 null', () => {
    setStoredToken('x');
    clearStoredToken();
    expect(getStoredToken()).toBeNull();
  });
});
