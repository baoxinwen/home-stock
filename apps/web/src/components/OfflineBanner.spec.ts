/**
 * 离线标识条：断网显示（含数据截至时间）、恢复在线消失、在线态零占位。
 * navigator.onLine 经 Object.defineProperty 模拟；online/offline 事件派发模拟。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import OfflineBanner from './OfflineBanner.vue';
import { SNAPSHOT_AT_KEY } from '../api';

function setOnline(v: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

describe('OfflineBanner 离线标识条', () => {
  beforeEach(() => {
    localStorage.removeItem(SNAPSHOT_AT_KEY);
    setOnline(true);
  });

  it('在线态零占位', () => {
    const wrapper = mount(OfflineBanner);
    expect(wrapper.find('.offline-bar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('初始即为离线（PWA 冷启动断网）：显示标识与数据截至时间', () => {
    localStorage.setItem(SNAPSHOT_AT_KEY, String(new Date('2026-11-19T10:30:00').getTime()));
    setOnline(false);
    const wrapper = mount(OfflineBanner);
    const bar = wrapper.find('.offline-bar');
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toContain('离线快照');
    expect(bar.text()).toContain('10:30');
    wrapper.unmount();
  });

  it('offline 事件触发显示、online 事件消失', async () => {
    const wrapper = mount(OfflineBanner);
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.offline-bar').exists()).toBe(true);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.offline-bar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('无快照时间戳时不显示时间', () => {
    setOnline(false);
    const wrapper = mount(OfflineBanner);
    expect(wrapper.find('.offline-bar').text()).not.toContain('数据截至');
    wrapper.unmount();
  });
});
