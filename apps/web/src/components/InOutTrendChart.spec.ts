/**
 * 入库 vs 浪费双柱对比图（2026-11-11 统计页图表扩充）：
 * 每月入库/浪费两柱、共用同一量纲上限、当前月高亮、零值不渲染金额标签。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import InOutTrendChart from './InOutTrendChart.vue';
import type { WasteTrendBucket } from '../lib/stats';

function buckets(months: string[], amounts: number[], counts: number[] = []): WasteTrendBucket[] {
  return months.map((month, i) => ({ month, amount: amounts[i], count: counts[i] ?? 0 }));
}

describe('InOutTrendChart 入库与浪费对比', () => {
  const purchase = buckets(
    ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
    [22.5, 8.5, 13, 362, 418.9, 988.2],
    [1, 1, 1, 7, 9, 7],
  );
  const waste = buckets(
    ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
    [0, 0, 0, 39.7, 22.6, 94.8],
    [0, 0, 0, 3, 2, 6],
  );

  it('渲染 6 组双柱，aria 带入库与浪费语义', () => {
    const wrapper = mount(InOutTrendChart, {
      props: { purchase, waste, currentPeriod: '2026-11' },
    });
    const groups = wrapper.findAll('.inout-group');
    expect(groups).toHaveLength(6);
    expect(wrapper.attributes('aria-label')).toContain('入库');
    expect(wrapper.attributes('aria-label')).toContain('浪费');
    // 每组两根柱
    expect(groups[0].findAll('.inout-bar')).toHaveLength(2);
  });

  it('当前月两柱带 now 高亮类；月份标签逐组渲染', () => {
    const wrapper = mount(InOutTrendChart, {
      props: { purchase, waste, currentPeriod: '2026-11' },
    });
    const groups = wrapper.findAll('.inout-group');
    expect(groups[5].find('.bar-in-now').exists()).toBe(true);
    expect(groups[5].find('.bar-out-now').exists()).toBe(true);
    expect(groups[0].find('.bar-in-now').exists()).toBe(false);
    expect(groups[5].text()).toContain('11月');
  });

  it('双系列共用量纲：柱高相对全组最大值（988.2）', () => {
    const wrapper = mount(InOutTrendChart, {
      props: { purchase, waste, currentPeriod: '2026-11' },
    });
    const groups = wrapper.findAll('.inout-group');
    // 11月入库 988.2 → 100%；11月浪费 94.8 → 10%
    const inStyle = groups[5].find('.bar-in').attributes('style') ?? '';
    const outStyle = groups[5].find('.bar-out').attributes('style') ?? '';
    expect(inStyle).toContain('100%');
    expect(outStyle).toContain('10%');
  });

  it('零值月份不渲染金额标签', () => {
    const wrapper = mount(InOutTrendChart, {
      props: { purchase, waste, currentPeriod: '2026-11' },
    });
    const june = wrapper.findAll('.inout-group')[0];
    // 入库 22.5 有标签；浪费 0 无标签
    expect(june.text()).toContain('¥22.50');
    expect(june.findAll('.inout-val')).toHaveLength(1);
  });
});
