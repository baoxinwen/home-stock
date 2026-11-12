/**
 * StreamText（铁律 4 流式打字）单测：逐字节点、错开延迟、时长与可读文本。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StreamText from './StreamText.vue';

describe('StreamText', () => {
  it('按字符逐个渲染，文本可读（screen reader 用 aria-label）', () => {
    const wrapper = mount(StreamText, { props: { text: '家庭库存' } });
    const chars = wrapper.findAll('.stream-char');
    expect(chars).toHaveLength(4);
    expect(chars.map((c) => c.text())).toEqual(['家', '庭', '库', '存']);
    expect(wrapper.find('.stream-text').attributes('aria-label')).toBe('家庭库存');
    expect(wrapper.text()).toContain('家庭库存');
  });

  it('相邻字错开 30ms、单字 90ms、支持整体起始延迟', () => {
    const wrapper = mount(StreamText, {
      props: { text: 'abc', staggerMs: 30, durationMs: 90, baseDelayMs: 120 },
    });
    const chars = wrapper.findAll('.stream-char');
    expect(chars[0].attributes('style')).toContain('animation-delay: 120ms');
    expect(chars[1].attributes('style')).toContain('animation-delay: 150ms');
    expect(chars[2].attributes('style')).toContain('animation-delay: 180ms');
    expect(chars[0].attributes('style')).toContain('animation-duration: 90ms');
  });

  it('默认参数：错开 30ms、时长 90ms', () => {
    const wrapper = mount(StreamText, { props: { text: 'hi' } });
    const chars = wrapper.findAll('.stream-char');
    expect(chars[0].attributes('style')).toContain('animation-delay: 0ms');
    expect(chars[1].attributes('style')).toContain('animation-delay: 30ms');
    expect(chars[0].attributes('style')).toContain('animation-duration: 90ms');
  });
});
