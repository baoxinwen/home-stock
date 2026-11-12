<script setup lang="ts">
/**
 * 浪费趋势柱状图（统计页与总览仪表盘共用）。
 * 数据由父层用 lib/stats 的 wasteTrend 聚合好传入；当前月柱高亮。
 */
import { computed } from 'vue';
import { barPercent, formatAmount, type WasteTrendBucket } from '../lib/stats';

const props = defineProps<{
  buckets: WasteTrendBucket[];
  /** 当前选中月份 YYYY-MM（该柱高亮） */
  currentPeriod: string;
  /** 图表语义标签（aria 用；入库节奏面板复用时传「入库」） */
  label?: string;
}>();

const max = computed(() => Math.max(0, ...props.buckets.map((b) => b.amount)));
</script>

<template>
  <div class="trend-chart" role="img" :aria-label="`近 ${buckets.length} 个月${label ?? '浪费'}金额柱状图`">
    <div v-for="b in buckets" :key="b.month" class="trend-col">
      <!-- ¥0 月不渲染金额标签（六个 ¥0.00 是视觉噪音）；有归档时件数小标在金额下 -->
      <span v-if="b.amount > 0" class="trend-val num">¥{{ formatAmount(b.amount) }}</span>
      <span v-if="b.count > 0" class="trend-count num">{{ b.count }} 件</span>
      <div
        class="trend-bar"
        :class="{ 'trend-bar-now': b.month === currentPeriod }"
        :style="{ height: `${barPercent(b.amount, max)}%` }"
      />
      <span class="trend-lbl">{{ Number(b.month.slice(5)) }}月</span>
    </div>
  </div>
</template>

<style scoped>
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 130px;
  padding-top: 4px;
}
.trend-col {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  min-width: 0;
}
.trend-val {
  font-size: 11px;
  color: var(--color-text);
}
.trend-count {
  font-size: 10px;
  color: var(--color-muted);
}
.trend-bar {
  width: 100%;
  max-width: 44px;
  border-radius: 4px 4px 2px 2px;
  background: var(--tone-blue-bg);
  outline: 1px solid var(--tone-blue-fg);
  outline-offset: -1px;
  min-height: 2px;
  transition: height 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
/* 当前月强调改用主题蓝实心（2026-11-11 审查 G-1：ink 实心在浅色成黑块、深色成白块，视觉失衡） */
.trend-bar-now {
  background: var(--tone-blue-fg);
  outline: none;
}
.trend-lbl {
  font-size: 11px;
  color: var(--color-muted);
  white-space: nowrap;
}
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
