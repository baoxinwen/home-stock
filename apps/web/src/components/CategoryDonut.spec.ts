/**
 * 库存类别价值环形图（2026-11-11 统计页图表扩充）：
 * conic-gradient 分段占比、中心总额、图例金额与占比、零值段剔除、空态。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CategoryDonut from './CategoryDonut.vue';

function bucket(key: string, name: string, count: number, value: number) {
  return { key, name, count, value };
}

describe('CategoryDonut 库存类别价值环形图', () => {
  it('按价值占比连续分段，中心显示库存总价值', () => {
    const wrapper = mount(CategoryDonut, {
      props: {
        buckets: [
          bucket('food', '食品', 9, 75),
          bucket('drink', '饮品', 1, 25),
        ],
      },
    });
    const ring = wrapper.find('.donut-ring');
    const bg = ring.attributes('style') ?? '';
    expect(bg).toContain('conic-gradient');
    // 75%/25% 分段边界
    expect(bg).toContain('75%');
    const hole = wrapper.find('.donut-hole');
    expect(hole.text()).toContain('¥100.00');
  });

  it('图例逐类渲染名称/件数/金额/占比；零值桶不渲染分段也不进图例', () => {
    const wrapper = mount(CategoryDonut, {
      props: {
        buckets: [
          bucket('food', '食品', 9, 1301.1),
          bucket('drink', '饮品', 1, 126),
          bucket('zero', '零值类', 2, 0),
        ],
      },
    });
    const items = wrapper.findAll('.donut-legend li');
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain('食品 · 9 件');
    expect(items[0].text()).toContain('91%');
    // 总额 = 1301.10 + 126 = 1427.10 → 饮品占比 round(8.83) = 9%
    expect(items[1].text()).toContain('¥126.00 · 9%');
    // 零值类不出现在任何位置
    expect(wrapper.text()).not.toContain('零值类');
  });

  it('空 buckets → 空态文案，不渲染环形', () => {
    const wrapper = mount(CategoryDonut, { props: { buckets: [] } });
    expect(wrapper.find('.panel-empty').exists()).toBe(true);
    expect(wrapper.find('.donut-ring').exists()).toBe(false);
  });
});
