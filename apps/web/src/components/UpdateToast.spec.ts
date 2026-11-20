/**
 * 新版本提示 toast（PWA prompt 模式）：
 * onNeedRefresh 触发显示、点「刷新」调 updateSW(true)、点「忽略」隐藏。
 * virtual:pwa-register mock 掉，不真注册 SW（happy-dom 无 serviceWorker）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => {
  const updateFn = vi.fn().mockResolvedValue(undefined);
  const registerSW = vi.fn((opts: { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, reg: unknown) => void }) => {
    (registerSW as unknown as { onNeedRefresh?: () => void }).onNeedRefresh = opts.onNeedRefresh;
    return updateFn;
  });
  return { updateFn, registerSW };
});

vi.mock('virtual:pwa-register', () => ({ registerSW: mocks.registerSW }));

import UpdateToast from './UpdateToast.vue';

function fireNeedRefresh(): void {
  const cb = (mocks.registerSW as unknown as { onNeedRefresh?: () => void }).onNeedRefresh;
  cb?.();
}

describe('UpdateToast 新版本提示', () => {
  beforeEach(() => {
    // happy-dom 无 navigator.serviceWorker，组件守卫会直接跳过注册——补桩走通注册路径
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    mocks.updateFn.mockClear();
    mocks.registerSW.mockClear();
  });

  it('默认不显示（无新版本时零占位）', () => {
    const wrapper = mount(UpdateToast);
    expect(wrapper.find('.update-toast').exists()).toBe(false);
    wrapper.unmount();
  });

  it('onNeedRefresh → 显示「新版本已就绪」；点「刷新」调 updateSW(true)', async () => {
    const wrapper = mount(UpdateToast);
    expect(mocks.registerSW).toHaveBeenCalledTimes(1);

    fireNeedRefresh();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.update-toast').exists()).toBe(true);
    expect(wrapper.find('.update-toast').text()).toContain('新版本已就绪');

    await wrapper.find('.update-refresh').trigger('click');
    expect(mocks.updateFn).toHaveBeenCalledWith(true);
    wrapper.unmount();
  });

  it('点「忽略」隐藏提示', async () => {
    const wrapper = mount(UpdateToast);
    fireNeedRefresh();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.update-toast').exists()).toBe(true);

    await wrapper.find('.update-dismiss').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.update-toast').exists()).toBe(false);
    expect(mocks.updateFn).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('评审 I-4：忽略后新版本仍在排队 → 24h 内回前台检查不重现，超过后重现', async () => {
    vi.useFakeTimers();
    try {
      const reg = { waiting: { postMessage: vi.fn() }, update: vi.fn(async () => {}) };
      const wrapper = mount(UpdateToast);
      const cbs = mocks.registerSW.mock.calls[0][0] as {
        onNeedRefresh?: () => void;
        onRegisteredSW?: (url: string, r: unknown) => void;
      };
      cbs.onRegisteredSW?.('sw.js', reg);
      cbs.onNeedRefresh?.();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.update-toast').exists()).toBe(true);

      await wrapper.find('.update-dismiss').trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.update-toast').exists()).toBe(false);

      // 24h 内回前台触发检查：不重现（频率上限防打扰）
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(wrapper.find('.update-toast').exists()).toBe(false);

      // 超过 24h 再检查：重现（update() 不重放 waiting 事件，靠显式检查 registration.waiting）
      await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(wrapper.find('.update-toast').exists()).toBe(true);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
