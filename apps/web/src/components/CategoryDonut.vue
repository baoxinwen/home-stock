<script setup lang="ts">
/**
 * 库存类别价值环形图（2026-11-11 统计页图表扩充，替代 6px 细条 CategoryValueBars）。
 * conic-gradient 连续分段（零值桶剔除），中心显示库存总价值，图例带件数/金额/占比。
 * 色板沿用 tone 色系（第 5 类起循环中性色），深浅色自动跟随主题。
 */
import { computed } from 'vue';
import { formatAmount } from '../lib/stats';

export interface CategoryDonutBucket {
  key: string;
  name: string;
  count: number;
  value: number;
}

const props = defineProps<{ buckets: CategoryDonutBucket[] }>();

/** 分段色板：tone 四色 + 中性灰兜底，超出循环（深浅色经 token 自适应） */
const PALETTE = [
  'var(--tone-blue-fg)',
  'var(--tone-green-fg)',
  'var(--tone-yellow-fg)',
  'var(--tone-red-fg)',
  'var(--color-muted)',
] as const;

function colorOf(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/** 零值桶不参与分段与图例（占比无意义） */
const segs = computed(() => props.buckets.filter((b) => b.value > 0));

const total = computed(() =>
  Math.round((segs.value.reduce((sum, b) => sum + b.value, 0) + Number.EPSILON) * 100) / 100,
);

function shareOf(value: number): number {
  if (total.value <= 0) return 0;
  return Math.round((value / total.value) * 100);
}

/** conic-gradient 按 value 占比连续铺满（同 StockHealthPanel 状态环形手法） */
const ringStyle = computed(() => {
  if (segs.value.length === 0) return '';
  let acc = 0;
  const parts = segs.value.map((b, i) => {
    const from = (acc / total.value) * 100;
    acc += b.value;
    return `${colorOf(i)} ${from}% ${(acc / total.value) * 100}%`;
  });
  return `conic-gradient(${parts.join(', ')})`;
});

const ariaLabel = computed(
  () =>
    `库存类别价值环形图：${segs.value.map((b) => `${b.name} ${shareOf(b.value)}%`).join('，')}`,
);
</script>

<template>
  <p v-if="buckets.length === 0" class="panel-empty">还没有在库物品</p>
  <div v-else class="cat-donut">
    <div class="donut-wrap" role="img" :aria-label="ariaLabel">
      <div class="donut-ring" :style="{ background: ringStyle }" />
      <div class="donut-hole">
        <b class="num">¥{{ formatAmount(total) }}</b>
        <span>库存总价值</span>
      </div>
    </div>
    <ul class="donut-legend">
      <li v-for="(b, i) in segs" :key="b.key">
        <span class="lg-dot" :style="{ background: colorOf(i) }" aria-hidden="true" />
        <span class="lg-name">{{ b.name }} · {{ b.count }} 件</span>
        <span class="lg-val num">¥{{ formatAmount(b.value) }} · {{ shareOf(b.value) }}%</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.panel-empty {
  font-size: 13px;
  color: var(--color-muted);
  padding: 14px 0 6px;
  margin: 0;
}
.cat-donut {
  display: flex;
  align-items: center;
  gap: 24px;
}
.donut-wrap {
  position: relative;
  width: 148px;
  height: 148px;
  flex: none;
}
.donut-ring {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.donut-hole {
  position: absolute;
  inset: 22px;
  border-radius: 50%;
  background: var(--color-surface);
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 2px;
}
.donut-hole b {
  font-size: 19px;
  line-height: 1;
  color: var(--color-ink);
}
.donut-hole span {
  font-size: 11px;
  color: var(--color-muted);
}
.donut-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
  font-size: 13px;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
}
.donut-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lg-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px; /* 子元素微圆角，保持紧凑 */
  flex: none;
}
.lg-name {
  color: var(--color-muted);
  white-space: nowrap;
  min-width: 0;
}
.lg-val {
  margin-left: auto;
  white-space: nowrap;
}
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
