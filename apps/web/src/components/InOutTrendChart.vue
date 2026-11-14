<script setup lang="ts">
/**
 * 入库 vs 浪费双柱对比图（2026-11-11 统计页图表扩充，合并原浪费趋势/入库节奏两个单柱面板）。
 * 每月一组两柱（入库=bar-blue、浪费=bar-red），双系列共用量纲（同一 max 归一，对比才公平）；
 * 当前月两柱以对应 fg 色描边强调（2026-11-11 审查 G-1：不用 ink 实心）。
 */
import { computed } from 'vue';
import { barPercent, formatAmount, type WasteTrendBucket } from '../lib/stats';

const props = defineProps<{
  purchase: WasteTrendBucket[];
  waste: WasteTrendBucket[];
  /** 当前选中月份 YYYY-MM（该组柱描边高亮） */
  currentPeriod: string;
}>();

/** 双系列共用量纲：任一柱的高度都相对同一上限 */
const max = computed(() =>
  Math.max(
    0,
    ...props.purchase.map((b) => b.amount),
    ...props.waste.map((b) => b.amount),
  ),
);

const ariaLabel = computed(
  () => `近 ${props.purchase.length} 个月入库与浪费金额对比柱状图`,
);

function isNow(month: string): boolean {
  return month === props.currentPeriod;
}
</script>

<template>
  <div class="inout-chart" role="img" :aria-label="ariaLabel">
    <div v-for="b in purchase" :key="b.month" class="inout-group">
      <div class="inout-bars">
        <div class="inout-slot">
          <span v-if="b.amount > 0" class="inout-val num">¥{{ formatAmount(b.amount) }}</span>
          <div
            class="inout-bar bar-in"
            :class="{ 'bar-in-now': isNow(b.month) }"
            :style="{ height: `${barPercent(b.amount, max)}%` }"
          />
        </div>
        <div class="inout-slot">
          <span
            v-if="(waste.find((w) => w.month === b.month)?.amount ?? 0) > 0"
            class="inout-val inout-val-waste num"
          >
            ¥{{ formatAmount(waste.find((w) => w.month === b.month)?.amount ?? 0) }}
          </span>
          <div
            class="inout-bar bar-out"
            :class="{ 'bar-out-now': isNow(b.month) }"
            :style="{ height: `${barPercent(waste.find((w) => w.month === b.month)?.amount ?? 0, max)}%` }"
          />
        </div>
      </div>
      <span class="inout-lbl">{{ Number(b.month.slice(5)) }}月</span>
    </div>
  </div>
</template>

<style scoped>
.inout-chart {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 170px;
  padding-top: 4px;
}
.inout-group {
  flex: 1;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 5px;
}
.inout-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 5px;
  min-height: 0;
}
.inout-slot {
  height: 100%;
  width: 100%;
  max-width: 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}
.inout-val {
  font-size: 10px;
  color: var(--color-text);
  white-space: nowrap;
}
/* 2026-11-12 移动端审查 M-2：390 宽 6 组双柱金额标签交错重叠——窄屏隐藏逐柱标签，
   月份标签保留，数值语义由 role=img 的 aria-label 承载 */
@media (max-width: 767px) {
  .inout-val {
    display: none;
  }
  .inout-slot {
    max-width: 20px;
  }
}
.inout-val-waste {
  color: var(--tone-red-fg);
}
.inout-bar {
  width: 100%;
  border-radius: 3px 3px 2px 2px;
  min-height: 2px;
  transition: height 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
.bar-in {
  background: var(--bar-blue);
}
.bar-out {
  background: var(--bar-red);
}
/* 当前月：对应 fg 色实心强调（不用 ink，审查 G-1） */
.bar-in-now {
  background: var(--tone-blue-fg);
}
.bar-out-now {
  background: var(--tone-red-fg);
}
.inout-lbl {
  font-size: 11px;
  color: var(--color-muted);
  text-align: center;
  white-space: nowrap;
}
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
