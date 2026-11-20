/**
 * 评审 I-6 — ChevronIcon 的 rotate 必须响应式：库存组/清单折叠/发送日志 4 处
 * 均以动态绑定传 rotate（如 :rotate="doneCollapsed ? 0 : 90"），
 * 此前 cls 为 setup 一次性常量，状态翻转后箭头方向纹丝不动。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ChevronIcon from './ChevronIcon.vue';

describe('ChevronIcon rotate 响应式（评审 I-6）', () => {
  it('rotate prop 变化后 class 跟随更新（0 → 90）', async () => {
    const wrapper = mount(ChevronIcon, { props: { rotate: 0 } });
    expect(wrapper.find('svg').classes()).not.toContain('chev-90');

    await wrapper.setProps({ rotate: 90 });
    expect(wrapper.find('svg').classes()).toContain('chev-90');

    await wrapper.setProps({ rotate: 0 });
    expect(wrapper.find('svg').classes()).not.toContain('chev-90');
  });
});
