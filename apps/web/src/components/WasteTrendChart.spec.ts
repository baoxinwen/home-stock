/**
 * 浪费趋势柱状图（统计页与总览共用）：
 * role=img 的 aria-label 必须自含全量数值（评审 A-H1——此前 label 只有描述无数据，
 * 子节点的金额/件数/月份被 role=img 整体遮蔽，SR 用户拿不到任何数值）。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WasteTrendChart from './WasteTrendChart.vue';
import type { WasteTrendBucket } from '../lib/stats';

const buckets: WasteTrendBucket[] = [
  { month: '2026-06', amount: 22.5, count: 1 },
  { month: '2026-07', amount: 0, count: 0 },
  { month: '2026-08', amount: 94.8, count: 6 },
];

describe('WasteTrendChart 浪费趋势', () => {
  it('渲染 3 列，当前月高亮，零值月不渲染金额标签', () => {
    const wrapper = mount(WasteTrendChart, {
      props: { buckets, currentPeriod: '2026-08' },
    });
    expect(wrapper.findAll('.trend-col')).toHaveLength(3);
    expect(wrapper.findAll('.trend-bar-now')).toHaveLength(1);
    // ¥0 月不渲染金额标签
    const cols = wrapper.findAll('.trend-col');
    expect(cols[1].findAll('.trend-val')).toHaveLength(0);
    expect(cols[2].text()).toContain('¥94.80');
  });

  it('aria 携带全量数值：月份 + 金额 + 件数（A-H1）', () => {
    const wrapper = mount(WasteTrendChart, {
      props: { buckets, currentPeriod: '2026-08' },
    });
    const label = wrapper.attributes('aria-label') ?? '';
    expect(label).toContain('近 3 个月');
    expect(label).toContain('6月 ¥22.50');
    expect(label).toContain('8月 ¥94.80');
    expect(label).toContain('1 件');
    expect(label).toContain('6 件');
    // 7月零值也应在 aria 中出现（数据完整性）
    expect(label).toContain('7月');
  });

  it('复用 label 参数替换语义（如「入库」）', () => {
    const wrapper = mount(WasteTrendChart, {
      props: { buckets, currentPeriod: '2026-08', label: '入库' },
    });
    expect(wrapper.attributes('aria-label')).toContain('入库金额');
  });
});
