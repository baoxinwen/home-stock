<script setup lang="ts">
/**
 * 库存健康面板（统计页）：剩余保质期分布堆叠条 + 状态构成环形图。
 * 数据由父层传在库物品与 today（ISO 日期，便于测试注入）；
 * 分桶/分段口径见 lib/stats 的 freshnessBuckets / stockStatusSplit
 * （状态按紧急度归组：expired > expiring > opened > ok，开封且临期计入临期）。
 */
import { computed } from 'vue';
import type { ItemDto } from '@home-stock/shared';
import { freshnessBuckets, stockStatusSplit } from '../lib/stats';

const props = defineProps<{ items: ItemDto[]; today: string }>();

const fresh = computed(() => freshnessBuckets(props.items, props.today));
const FRESH_SEGS = [
  { key: 'expired', label: '已过期', cls: 'seg-expired' },
  { key: 'd7', label: '≤7 天', cls: 'seg-d7' },
  { key: 'd30', label: '8-30 天', cls: 'seg-d30' },
  { key: 'd90', label: '31-90 天', cls: 'seg-d90' },
  { key: 'over90', label: '90 天+', cls: 'seg-over90' },
  { key: 'undated', label: '未填日期', cls: 'seg-undated' },
] as const;

const status = computed(() => stockStatusSplit(props.items));
/** 分段色直引全局 tone token（评审 C-H1：scoped :root 中转变量编译为 [data-v]:root 永不匹配，
 *  conic-gradient 整条失效致环形透明——与 CategoryDonut 同款直引写法） */
const STATUS_SEGS = [
  { key: 'expired', label: '已过期', cls: 'st-expired', color: 'var(--tone-red-fg)' },
  { key: 'expiring', label: '临期', cls: 'st-expiring', color: 'var(--tone-yellow-fg)' },
  { key: 'opened', label: '已开封', cls: 'st-opened', color: 'var(--tone-blue-fg)' },
  { key: 'ok', label: '正常', cls: 'st-ok', color: 'var(--tone-green-fg)' },
] as const;

const statusTotal = computed(() => props.items.length);
/** 环形分段：零值段跳过，conic-gradient 按件数占比连续铺满 */
const donutStyle = computed(() => {
  const segs = STATUS_SEGS.map((s) => ({ ...s, n: status.value[s.key] })).filter((s) => s.n > 0);
  if (segs.length === 0 || statusTotal.value === 0) {
    return 'conic-gradient(var(--color-track) 0 100%)';
  }
  let acc = 0;
  const parts = segs.map((s) => {
    const from = (acc / statusTotal.value) * 100;
    acc += s.n;
    return `${s.color} ${from}% ${(acc / statusTotal.value) * 100}%`;
  });
  return `conic-gradient(${parts.join(', ')})`;
});

const freshAria = computed(
  () => `保质期分布：${FRESH_SEGS.map((s) => `${s.label} ${fresh.value[s.key]} 件`).join('，')}`,
);
const statusAria = computed(
  () => `状态构成：${STATUS_SEGS.map((s) => `${s.label} ${status.value[s.key]} 件`).join('，')}`,
);
</script>

<template>
  <div class="stock-health">
    <div class="health-row">
      <h3 class="health-label">保质期分布</h3>
      <div class="fresh-track" role="img" :aria-label="freshAria">
        <div
          v-for="seg in FRESH_SEGS.filter((s) => fresh[s.key] > 0)"
          :key="seg.key"
          class="fresh-seg"
          :class="seg.cls"
          :style="{ width: `${(fresh[seg.key] / items.length) * 100}%` }"
        />
      </div>
      <ul class="health-legend">
        <li v-for="seg in FRESH_SEGS.filter((s) => fresh[s.key] > 0)" :key="seg.key">
          <span class="dot" :class="seg.cls" aria-hidden="true" />
          <span class="legend-label">{{ seg.label }}</span>
          <b class="num">{{ fresh[seg.key] }}</b>
        </li>
      </ul>
    </div>

    <div class="health-row">
      <h3 class="health-label">状态构成</h3>
      <div class="status-row">
        <div class="status-donut" role="img" :aria-label="statusAria">
          <div class="donut-ring" :style="{ background: donutStyle }" />
          <div class="donut-hole">
            <b class="num">{{ statusTotal }}</b>
            <span>件在库</span>
          </div>
        </div>
        <ul class="health-legend">
          <li v-for="seg in STATUS_SEGS.filter((s) => status[s.key] > 0)" :key="seg.key">
            <span class="dot" :class="seg.cls" aria-hidden="true" />
            <span class="legend-label">{{ seg.label }}</span>
            <b class="num">{{ status[seg.key] }}</b>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stock-health {
  display: grid;
  gap: 16px;
}
.health-label {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-semibold);
  margin: 0 0 8px;
}
/* 保质期堆叠条 */
.fresh-track {
  display: flex;
  height: 14px;
  border-radius: var(--radius-s); /* 子元素微圆角，保持紧凑 */
  overflow: hidden;
  background: var(--color-track);
}
.fresh-seg {
  height: 100%;
  min-width: 2px;
}
.seg-expired { background: var(--tone-red-fg); }
.seg-d7 { background: var(--tone-yellow-fg); }
.seg-d30 { background: var(--tone-blue-fg); }
.seg-d90 { background: var(--tone-green-fg); }
.seg-over90 { background: var(--tone-green-bg); outline: 1px solid var(--tone-green-fg); outline-offset: -1px; }
/* 评审 C-M3：未填日期段与底轨同为 --color-track（1.0:1 不可辨）——沿用 seg-over90 空心语言补描边 */
.seg-undated {
  background: var(--color-track);
  outline: 1px solid var(--color-muted);
  outline-offset: -1px;
}

/* 环形 + 图例左右排 */
.status-row {
  display: flex;
  align-items: center;
  gap: 20px;
}
.status-donut {
  position: relative;
  width: 96px;
  height: 96px;
  flex: none;
}
.donut-ring {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.donut-hole {
  position: absolute;
  inset: 16px;
  border-radius: 50%;
  background: var(--color-surface);
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1px;
}
.donut-hole b {
  font-size: 20px;
  line-height: 1;
  color: var(--color-ink);
}
.donut-hole span {
  font-size: 11px;
  color: var(--color-muted);
}
/* 图例点：与环形分段同色（直引 tone token） */
.dot.st-expired { background: var(--tone-red-fg); }
.dot.st-expiring { background: var(--tone-yellow-fg); }
.dot.st-opened { background: var(--tone-blue-fg); }
.dot.st-ok { background: var(--tone-green-fg); }

.health-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 6px 16px;
  font-size: 12px;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
}
.health-legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-label {
  color: var(--color-muted);
  white-space: nowrap;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 3px; /* 子元素微圆角，保持紧凑 */
  flex: none;
}
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
