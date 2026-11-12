/**
 * 价值 Top 排行条形（2026-11-11 统计页图表扩充）：
 * 名称/数量与金额渲染、条宽相对最大值、空态。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ItemDto } from '@home-stock/shared';
import TopValueBars from './TopValueBars.vue';

function entry(id: number, name: string, quantity: number, unit: string | null, price: number) {
  return {
    item: {
      id,
      name,
      categoryId: null,
      purchaseDate: null,
      quantity,
      unit,
      price,
      expiryDate: null,
      opened: 0,
      openedAt: null,
      openShelfDays: null,
      remindDays: null,
      minQuantity: null,
      status: 'active',
      archivedReason: null,
      archivedAt: null,
      createdAt: null,
      updatedAt: null,
      source: 'manual',
      effectiveExpiryDate: null,
      expiryStatus: 'none',
    } as ItemDto,
    value: Math.round(price * quantity * 100) / 100,
  };
}

describe('TopValueBars 价值 Top 排行', () => {
  it('逐行渲染名称/数量单位/金额，条宽相对最大值', () => {
    const wrapper = mount(TopValueBars, {
      props: {
        entries: [
          entry(1, '鸡蛋', 30, '枚', 25.8),
          entry(2, '可乐', 6, '罐', 21),
        ],
      },
    });
    const rows = wrapper.findAll('.tv-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('鸡蛋');
    expect(rows[0].text()).toContain('30 枚');
    expect(rows[0].text()).toContain('¥774.00');
    // 最大值行 100%
    expect(rows[0].find('.tv-fill').attributes('style')).toContain('100%');
    // 126/774 ≈ 16%
    expect(rows[1].find('.tv-fill').attributes('style')).toContain('16%');
  });

  it('空 entries → 空态文案', () => {
    const wrapper = mount(TopValueBars, { props: { entries: [] } });
    expect(wrapper.find('.panel-empty').exists()).toBe(true);
    expect(wrapper.findAll('.tv-row')).toHaveLength(0);
  });
});
