<script setup lang="ts">
/**
 * 价值 Top 排行（2026-11-11 统计页图表扩充）：
 * 在库物品按占用价值降序的横向条形（数据由父层用 lib/stats topValueItems 聚合好传入）。
 * 条宽相对榜首归一，零值不渲染金额标签。
 */
import { computed } from 'vue';
import { barPercent, formatAmount, type TopValueEntry } from '../lib/stats';

const props = defineProps<{ entries: TopValueEntry[] }>();

const max = computed(() => Math.max(0, ...props.entries.map((e) => e.value)));

function quantityText(e: TopValueEntry): string {
  const q = e.item.quantity ?? 0;
  return e.item.unit ? `${q} ${e.item.unit}` : `${q}`;
}
</script>

<template>
  <p v-if="entries.length === 0" class="panel-empty">还没有在库物品</p>
  <ol v-else class="top-values" role="list" aria-label="库存价值排行">
    <li v-for="e in entries" :key="e.item.id" class="tv-row">
      <div class="tv-head">
        <span class="tv-name">{{ e.item.name }}</span>
        <span class="tv-qty">{{ quantityText(e) }}</span>
        <span class="tv-val num">¥{{ formatAmount(e.value) }}</span>
      </div>
      <div class="bar-track" role="presentation">
        <div class="tv-fill" :style="{ width: `${barPercent(e.value, max)}%` }" />
      </div>
    </li>
  </ol>
</template>

<style scoped>
.panel-empty {
  font-size: 13px;
  color: var(--color-muted);
  padding: 14px 0 6px;
  margin: 0;
}
.top-values {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.tv-row {
  display: grid;
  gap: 4px;
}
.tv-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text);
}
.tv-name {
  font-weight: var(--fw-semibold);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tv-qty {
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
}
.tv-val {
  margin-left: auto;
  white-space: nowrap;
}
.bar-track {
  height: 8px;
  border-radius: 4px; /* 子元素微圆角，保持紧凑 */
  background: var(--color-track);
  overflow: hidden;
}
.tv-fill {
  height: 100%;
  border-radius: 4px; /* 子元素微圆角，保持紧凑 */
  background: var(--tone-blue-bg);
  outline: 1px solid var(--tone-blue-fg);
  outline-offset: -1px;
  transition: width 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
