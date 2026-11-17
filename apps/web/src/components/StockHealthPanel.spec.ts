/**
 * 库存健康面板：状态环形分段色直引 tone token（评审 C-H1——scoped :root 中转层
 * 编译为 [data-v]:root 永不匹配，conic-gradient 整条失效致环形透明）；
 * 保质期分布按桶渲染、aria 带全量数据。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StockHealthPanel from './StockHealthPanel.vue';
import type { ItemDto } from '@home-stock/shared';

function item(partial: Partial<ItemDto>): ItemDto {
  return {
    id: 1,
    name: '牛奶',
    categoryId: null,
    quantity: 1,
    unit: null,
    price: null,
    purchaseDate: null,
    expiryDate: '2026-06-01',
    effectiveExpiryDate: '2026-06-01',
    opened: 0,
    openedAt: null,
    openShelfDays: null,
    remindDays: null,
    minQuantity: null,
    status: 'active',
    archivedReason: null,
    archivedAt: null,
    imagePath: null,
    expiryStatus: 'ok',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  } as ItemDto;
}

describe('StockHealthPanel 库存健康', () => {
  it('状态环形内联样式直引 tone token，不经过 scoped :root 中转变量（C-H1）', () => {
    const wrapper = mount(StockHealthPanel, {
      props: {
        items: [item({ id: 1 }), item({ id: 2, expiryStatus: 'expired', name: '面包' })],
        today: '2026-06-01',
      },
    });
    const ring = wrapper.find('.donut-ring');
    expect(ring.exists()).toBe(true);
    const style = ring.attributes('style') ?? '';
    // 分段色必须是全局 tone token（scoped :root 的 --st-* 永不生效）
    expect(style).toContain('var(--tone-');
    expect(style).not.toContain('var(--st-');
  });

  it('保质期分布按非零桶渲染分段并带全量 aria 数据', () => {
    const wrapper = mount(StockHealthPanel, {
      props: {
        items: [
          item({ id: 1, expiryStatus: 'expired', name: '面包', effectiveExpiryDate: '2026-05-01', expiryDate: '2026-05-01' }),
          item({ id: 2, expiryDate: '2026-12-01', effectiveExpiryDate: '2026-12-01' }),
        ],
        today: '2026-06-01',
      },
    });
    const track = wrapper.find('.fresh-track');
    expect(track.attributes('aria-label')).toContain('已过期 1 件');
    expect(track.attributes('aria-label')).toContain('90 天+ 1 件');
    // 过期段 + 90 天+ 段
    expect(track.findAll('.fresh-seg')).toHaveLength(2);
  });
});
