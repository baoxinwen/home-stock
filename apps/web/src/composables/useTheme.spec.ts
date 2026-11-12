/**
 * 主题偏好组合式单测：resolve 纯函数、applyTheme 落 data-theme、
 * 持久化校验、系统偏好监听、initTheme 预挂载一次性应用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  initTheme,
  readThemePreference,
  resolveTheme,
  useTheme,
  type ThemePreference,
} from './useTheme';

function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: initialDark,
    addEventListener: vi.fn((_t: string, cb: (e: { matches: boolean }) => void) =>
      listeners.add(cb),
    ),
    removeEventListener: vi.fn((_t: string, cb: (e: { matches: boolean }) => void) =>
      listeners.delete(cb),
    ),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  return {
    fire(dark: boolean) {
      mql.matches = dark;
      listeners.forEach((cb) => cb({ matches: dark }));
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('resolveTheme', () => {
  it('system → 跟随系统；light/dark → 强制指定', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('readThemePreference / 持久化', () => {
  it('无存储 → system；非法值 → system；合法值原样返回', () => {
    expect(readThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'bogus');
    expect(readThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemePreference()).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('写 data-theme 到目标元素', () => {
    const el = document.createElement('div');
    applyTheme('dark', el, false);
    expect(el.dataset.theme).toBe('dark');
    applyTheme('light', el, true);
    expect(el.dataset.theme).toBe('light');
  });
});

describe('useTheme', () => {
  it('默认 system；setPreference 持久化并应用到 documentElement（watchEffect 微任务刷新）', async () => {
    stubMatchMedia(false);
    const { preference, resolved, setPreference } = useTheme();
    expect(preference.value).toBe('system');
    expect(resolved.value).toBe('light');
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('light');

    setPreference('dark');
    await nextTick();
    expect(preference.value).toBe('dark');
    expect(resolved.value).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('system 偏好下系统切换实时生效（matchMedia change）', async () => {
    const stub = stubMatchMedia(false);
    const { preference, resolved } = useTheme();
    expect(preference.value).toBe('system');
    expect(resolved.value).toBe('light');
    stub.fire(true);
    await nextTick();
    expect(resolved.value).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    // 存储仍是 system（未显式选择）
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('启动时读取已存偏好', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { preference, resolved } = useTheme();
    expect(preference.value).toBe('dark');
    expect(resolved.value).toBe('dark');
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('initTheme（main.ts 预挂载一次性应用）', () => {
  it('按存储/系统偏好设置 data-theme，无副作用残留', () => {
    const stub = stubMatchMedia(true);
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    stub.fire(false);
    // 一次性：不监听后续变化
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('存储 dark 优先于系统 light', () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('类型完整性', () => {
  it('ThemePreference 三个可选值', () => {
    const all: ThemePreference[] = ['system', 'light', 'dark'];
    expect(all).toHaveLength(3);
  });
});
