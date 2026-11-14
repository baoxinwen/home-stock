<script setup lang="ts">
/**
 * 统计仪表盘（M10 浪费统计 + PC 充实化 + 健康度扩充）：
 * - 月份切换作用于全部月份维度模块（浪费概览/趋势窗口/入库节奏/当月浪费）
 * - 模块（2×3）：浪费趋势 / 入库节奏 / 临期提醒 / 库存类别价值 / 库存健康 / 当月浪费
 * - 基础数据（在库/归档/类别）挂载时拉取一次，与月份切换解耦；口径与 server 对齐
 *   （仅过期丢弃计浪费、金额两位小数）。
 * - 趋势/临期/类别价值展示件抽为共享组件（总览仪表盘复用）；库存健康抽 StockHealthPanel。
 */
import { computed, onMounted, ref } from 'vue';
import type { CategoryDto, ItemDto, WasteStatsDto } from '@home-stock/shared';
import { api } from '../api';
import {
  barPercent,
  currentPeriod,
  expiringWithin,
  formatAmount,
  formatPeriodCN,
  monthOverMonth,
  purchaseTrend,
  shiftPeriod,
  stockOverview,
  topValueItems,
  usageSplit,
  wasteTrend,
  type MonthDelta,
} from '../lib/stats';
import { todayISO } from '../lib/dates';
import ExpiringList from '../components/ExpiringList.vue';
import CategoryDonut from '../components/CategoryDonut.vue';
import ChevronIcon from '../components/ChevronIcon.vue';
import InOutTrendChart from '../components/InOutTrendChart.vue';
import StockHealthPanel from '../components/StockHealthPanel.vue';
import TopValueBars from '../components/TopValueBars.vue';

const TONES = ['blue', 'green', 'yellow', 'red'] as const;
type Tone = (typeof TONES)[number];

const TREND_MONTHS = 6;
const EXPIRING_WINDOW_DAYS = 30;
const TOP_VALUE_LIMIT = 8;

const period = ref(currentPeriod());
const stats = ref<WasteStatsDto | null>(null);
const loading = ref(true);
const error = ref('');

const baseActive = ref<ItemDto[]>([]);
const baseArchived = ref<ItemDto[]>([]);
const baseCategories = ref<CategoryDto[]>([]);
const baseLoading = ref(true);
const baseError = ref('');
// 当天日期只取一次（测试可用假时钟注入）
const today = todayISO();

/** 请求序号：快速切换月份时丢弃过期响应，避免旧数据覆盖新月份 */
let requestSeq = 0;

const isCurrentMonth = computed(() => period.value >= currentPeriod());
const periodLabel = computed(() => formatPeriodCN(period.value));
const maxAmount = computed(() =>
  Math.max(0, ...(stats.value?.byCategory.map((b) => b.amount) ?? [])),
);
const maxCount = computed(() =>
  Math.max(0, ...(stats.value?.byCategory.map((b) => b.count) ?? [])),
);
/** 金额全为 0（未填价格）时按件数归一，保证条形仍有可视化反馈 */
const barMax = computed(() => (maxAmount.value > 0 ? maxAmount.value : maxCount.value));
const emptyText = computed(
  () => `${isCurrentMonth.value ? '本月' : '该月'}没有浪费，很好`,
);

// ---------- 库存总览 / 模块派生 ----------
const overview = computed(() => stockOverview(baseActive.value));
/** D-M2：没有任何价格数据时总价值显「—」（对齐总览 D-17） */
const hasAnyPrice = computed(() => baseActive.value.some((it) => it.price !== null));
const catNameOf = (id: number | null): string =>
  baseCategories.value.find((c) => c.id === id)?.name ?? '未分类';
const stockCats = computed(() =>
  overview.value.byCategory.map((b) => ({
    key: String(b.categoryId ?? 'uncategorized'),
    name: catNameOf(b.categoryId),
    count: b.count,
    value: b.value,
  })),
);

const trend = computed(() => wasteTrend(baseArchived.value, TREND_MONTHS, period.value));
const trendLabel = computed(
  () => `${formatPeriodCN(trend.value[0]?.month ?? period.value)} ~ ${periodLabel.value}`,
);

/** 入库节奏与浪费趋势同窗口对照（含归档物品——它们也曾入库）；缺购买日期不计 */
const purchaseBuckets = computed(() =>
  purchaseTrend([...baseActive.value, ...baseArchived.value], TREND_MONTHS, period.value),
);

/** 2026-11-11 图表扩充：浪费与入库合并双柱对照 */
const currentWasteBucket = computed(() => trend.value[TREND_MONTHS - 1]);

/** 损耗率 = 选中月浪费金额 ÷ 同月入库金额；入库为 0 不可比，显示 — */
const lossRate = computed(() => {
  const inAmount = purchaseBuckets.value[TREND_MONTHS - 1]?.amount ?? 0;
  const outAmount = currentWasteBucket.value?.amount ?? 0;
  if (inAmount <= 0) return null;
  return Math.round((outAmount / inAmount) * 100);
});

/** 价值 Top 排行：在库物品按占用价值降序前 8 */
const stockTopItems = computed(() => topValueItems(baseActive.value, 8));

/** KPI 环比：浪费件数/金额较上月（客户端聚合口径与服务端一致：仅过期丢弃） */
const wasteCountDelta = computed(() =>
  monthOverMonth(trend.value[TREND_MONTHS - 1].count, trend.value[TREND_MONTHS - 2].count),
);
const wasteAmountDelta = computed(() =>
  monthOverMonth(trend.value[TREND_MONTHS - 1].amount, trend.value[TREND_MONTHS - 2].amount),
);

const expiringList = computed(() =>
  expiringWithin(baseActive.value, today, EXPIRING_WINDOW_DAYS),
);

const usage = computed(() => usageSplit(baseArchived.value, period.value));
const usageTotal = computed(() => usage.value.wasted.count + usage.value.usedUp.count);
const wastedPercent = computed(() => {
  if (usageTotal.value === 0) return 0;
  return Math.round((usage.value.wasted.count / usageTotal.value) * 100);
});

function barValue(bucket: { amount: number; count: number }): number {
  return maxAmount.value > 0 ? bucket.amount : bucket.count;
}

/** 环比文案：浪费上升是坏事（红 ↑），下降是好事（绿 ↓） */
function deltaLabel(d: MonthDelta): string {
  if (d.kind === 'new') return '较上月新增';
  if (d.kind === 'flat') return '与上月持平';
  return `较上月${d.percent! > 0 ? '↑' : '↓'} ${Math.abs(d.percent!)}%`;
}

function deltaClass(d: MonthDelta): string {
  if (d.kind === 'up' || d.kind === 'new') return 'delta-bad';
  if (d.kind === 'down') return 'delta-good';
  return 'delta-flat';
}

async function load(): Promise<void> {
  const seq = ++requestSeq;
  loading.value = true;
  error.value = '';
  try {
    const data = await api.getWasteStats({ period: period.value });
    if (seq !== requestSeq) return;
    stats.value = data;
  } catch (e) {
    if (seq !== requestSeq) return;
    stats.value = null;
    error.value = e instanceof Error ? e.message : '加载失败，请重试';
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

/** 基础数据只拉一次，与月份切换解耦 */
async function loadBase(): Promise<void> {
  baseLoading.value = true;
  baseError.value = '';
  try {
    const [active, archived, categories] = await Promise.all([
      api.listItems(),
      api.listItems({ status: 'archived' }),
      api.listCategories(),
    ]);
    baseActive.value = active;
    baseArchived.value = archived;
    baseCategories.value = categories;
  } catch (e) {
    baseError.value = e instanceof Error ? e.message : '加载失败，请重试';
  } finally {
    baseLoading.value = false;
  }
}

async function go(delta: number): Promise<void> {
  const target = shiftPeriod(period.value, delta);
  // 不允许翻到未来月份
  if (target > currentPeriod()) return;
  period.value = target;
  await load();
}

function toneFor(i: number): Tone {
  return TONES[i % TONES.length];
}

function staggerStyle(i: number): Record<string, string> {
  return { 'animation-delay': `${Math.min(i, 8) * 60}ms` };
}

onMounted(() => {
  void load();
  void loadBase();
});
</script>

<template>
  <div class="stats-view wb-page">
    <header class="page-head">
      <h1 class="page-title">统计</h1>
    </header>

    <section class="period-switch" aria-label="选择月份">
      <button class="month-btn month-prev" type="button" @click="go(-1)">
        <ChevronIcon :rotate="180" /> 上一月
      </button>
      <span class="period-label">{{ periodLabel }}</span>
      <button
        class="month-btn month-next"
        type="button"
        :disabled="isCurrentMonth"
        @click="go(1)"
      >
        下一月 <ChevronIcon />
      </button>
    </section>

    <!-- KPI 行：浪费（当月，服务端口径，带环比）+ 库存总览（全量，客户端口径） -->
    <section class="kpi-row" aria-label="统计总览">
      <div class="kpi-card enter">
        <span class="kpi-label">浪费件数</span>
        <span class="kpi-value overview-count num">
          {{ stats ? stats.totalCount : '—' }}<span class="kpi-unit">件</span>
        </span>
        <span v-if="stats" class="kpi-delta" :class="deltaClass(wasteCountDelta)">{{ deltaLabel(wasteCountDelta) }}</span>
      </div>
      <div class="kpi-card enter" style="animation-delay: 40ms">
        <span class="kpi-label">浪费金额</span>
        <span class="kpi-value kpi-money overview-amount num">{{
          stats ? `¥${formatAmount(stats.totalAmount)}` : '—'
        }}</span>
        <span v-if="stats" class="kpi-delta" :class="deltaClass(wasteAmountDelta)">{{ deltaLabel(wasteAmountDelta) }}</span>
      </div>
      <div class="kpi-card enter" style="animation-delay: 80ms">
        <span class="kpi-label">在库物品</span>
        <span class="kpi-value">{{ baseLoading ? '—' : overview.count }}<span class="kpi-unit">件</span></span>
      </div>
      <div class="kpi-card enter" style="animation-delay: 120ms">
        <span class="kpi-label">库存总价值</span>
        <span class="kpi-value kpi-money num">{{ baseLoading ? '—' : hasAnyPrice ? `¥${formatAmount(overview.value)}` : '— · 未录价格' }}</span>
      </div>
      <!-- 2026-11-11 图表扩充：损耗率 = 选中月浪费金额 ÷ 同月入库金额 -->
      <div class="kpi-card enter" style="animation-delay: 160ms">
        <span class="kpi-label">损耗率</span>
        <span class="kpi-value num">{{ lossRate === null ? '—' : `${lossRate}%` }}</span>
        <span class="kpi-sub-inline">当月浪费 ÷ 入库</span>
      </div>
    </section>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="loading && !stats" class="muted-text">加载中…</p>

    <!-- 仪表盘模块（依赖基础数据，与月份统计解耦）：2×3 六面板
         2026-11-11 图表扩充：浪费/入库合并双柱 + 类别价值环形 + 价值 Top 排行 -->
    <p v-if="baseError" class="error-text" role="alert">{{ baseError }}</p>
    <section v-else-if="!baseLoading" class="module-grid" aria-label="库存与浪费模块">
      <section class="panel enter" aria-label="入库与浪费对比">
        <h2 class="panel-title">入库与浪费对比</h2>
        <p class="panel-sub">近 {{ TREND_MONTHS }} 个月每月金额对照（入库按已填购买日期，浪费仅过期丢弃，{{ trendLabel }}）</p>
        <InOutTrendChart :purchase="purchaseBuckets" :waste="trend" :current-period="period" />
      </section>

      <section class="panel enter" style="animation-delay: 60ms" aria-label="库存类别价值">
        <h2 class="panel-title">库存类别价值</h2>
        <CategoryDonut :buckets="stockCats" />
      </section>

      <section class="panel enter" style="animation-delay: 120ms" aria-label="库存健康">
        <h2 class="panel-title">
          库存健康
          <span class="panel-sub-inline">开封且临期计入临期</span>
        </h2>
        <p v-if="overview.count === 0" class="panel-empty">还没有在库物品</p>
        <StockHealthPanel v-else :items="baseActive" :today="today" />
      </section>

      <section class="panel enter" style="animation-delay: 180ms" aria-label="当月浪费">
        <h2 class="panel-title">当月浪费 <span class="panel-sub-inline">{{ periodLabel }}</span></h2>
        <p v-if="!stats" class="panel-empty">{{ error || '加载中…' }}</p>
        <template v-else-if="stats.totalCount === 0 && usageTotal === 0">
          <p class="panel-empty">{{ emptyText }}</p>
        </template>
        <template v-else>
          <div class="usage-track" role="img" :aria-label="`浪费 ${usage.wasted.count} 件，用完 ${usage.usedUp.count} 件`">
            <div class="usage-seg usage-seg-waste" :style="{ width: `${wastedPercent}%` }" />
            <div class="usage-seg usage-seg-used" :style="{ width: `${100 - wastedPercent}%` }" />
          </div>
          <div class="usage-legend">
            <span class="usage-item">
              <span class="usage-dot usage-dot-waste" aria-hidden="true" />
              过期丢弃 <b class="num">{{ usage.wasted.count }}</b> 件 · ¥{{ formatAmount(usage.wasted.amount) }}
            </span>
            <span class="usage-item">
              <span class="usage-dot usage-dot-used" aria-hidden="true" />
              用完 <b class="num">{{ usage.usedUp.count }}</b> 件 · ¥{{ formatAmount(usage.usedUp.amount) }}
            </span>
          </div>
          <template v-if="stats.totalCount > 0">
            <h3 class="waste-cats-title">按类别分布</h3>
            <ul class="category-list">
              <li
                v-for="(bucket, i) in stats.byCategory"
                :key="bucket.categoryId ?? 'uncategorized'"
                class="category-row enter"
                :style="staggerStyle(i)"
              >
                <div class="row-head">
                  <span class="cat-badge" :class="`tone-${toneFor(i)}`">
                    {{ bucket.categoryName }}
                  </span>
                  <span class="cat-figures">
                    <span class="cat-count">{{ bucket.count }} 件</span>
                    <span class="cat-amount num">¥{{ formatAmount(bucket.amount) }}</span>
                  </span>
                </div>
                <div class="bar-track" role="presentation">
                  <div
                    class="bar-fill"
                    :class="`fill-${toneFor(i)}`"
                    :style="{ width: `${barPercent(barValue(bucket), barMax)}%` }"
                  />
                </div>
              </li>
            </ul>
          </template>
          <p v-else class="panel-empty">该月没有浪费</p>
        </template>
      </section>

      <section class="panel enter" style="animation-delay: 240ms" aria-label="价值排行">
        <h2 class="panel-title">
          价值 Top 排行
          <span class="panel-sub-inline">占用价值前 {{ TOP_VALUE_LIMIT }} 名</span>
        </h2>
        <TopValueBars :entries="stockTopItems" />
      </section>

      <section class="panel enter" style="animation-delay: 300ms" aria-label="临期提醒">
        <h2 class="panel-title">
          临期提醒
          <span class="badge tone-yellow">未来 {{ EXPIRING_WINDOW_DAYS }} 天 · {{ expiringList.length }} 件</span>
        </h2>
        <ExpiringList :entries="expiringList" :window-days="EXPIRING_WINDOW_DAYS" />
      </section>
    </section>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 16px;
}
.period-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 18px;
}
.month-btn {
  background: var(--color-field);
  border-radius: var(--radius-pill);
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease, background 150ms ease-out;
}
.month-btn:hover:not(:disabled) {
  background: var(--color-hover);
}
.month-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.month-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.period-label {
  font-size: 15px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}

/* KPI 行 */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}
/* 2026-11-12 移动端审查 M-7：5 卡 2+2+1 布局下损耗率卡跨双列，不再独占半宽留空 */
@media (max-width: 1023px) {
  .kpi-card:last-child {
    grid-column: 1 / -1;
  }
}
.kpi-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.kpi-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.kpi-value {
  font-size: 28px;
  line-height: 1.1;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}
.kpi-unit {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 3px;
}
.kpi-money {
  font-size: 22px;
  white-space: nowrap;
}
/* KPI 环比（浪费上升=坏红、下降=好绿） */
.kpi-delta {
  font-size: 12px;
}
/* 损耗率卡的口径说明行（2026-11-11 图表扩充） */
.kpi-sub-inline {
  font-size: 12px;
  color: var(--color-muted);
}
.delta-bad { color: var(--tone-red-fg); }
.delta-good { color: var(--tone-green-fg); }
.delta-flat { color: var(--color-muted); }
@media (min-width: 1024px) {
  /* 2026-11-11 图表扩充：KPI 4→5 卡（新增损耗率） */
  .kpi-row {
    grid-template-columns: repeat(5, 1fr);
  }
}

/* 仪表盘模块网格：移动单列，PC 双列 */
.module-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 20px;
}
@media (min-width: 1024px) {
  .module-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.panel {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 16px 18px;
  min-width: 0;
}
.panel-title {
  font-size: 15px;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-sub {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0 0 12px;
}
.panel-sub-inline {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
}
.panel-empty {
  font-size: 13px;
  color: var(--color-muted);
  padding: 14px 0 6px;
  margin: 0;
}

/* 浪费 vs 用完 */
.usage-track {
  display: flex;
  height: 14px;
  border-radius: var(--radius-s); /* 用完/浪费分段条 */;
  overflow: hidden;
  background: var(--color-track);
  margin: 8px 0 12px;
}
.usage-seg {
  height: 100%;
}
.usage-seg-waste {
  background: var(--tone-red-fg);
}
.usage-seg-used {
  background: var(--tone-green-bg);
  outline: 1px solid var(--tone-green-fg);
  outline-offset: -1px;
}
.usage-legend {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text);
}
.usage-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.usage-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px; /* 子元素微圆角，保持紧凑 */;
  flex: none;
}
.usage-dot-waste {
  background: var(--tone-red-fg);
}
.usage-dot-used {
  background: var(--tone-green-bg);
  outline: 1px solid var(--tone-green-fg);
}

/* 当月浪费面板内的类别细分 */
.waste-cats-title {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-semibold);
  margin: 6px 0 0;
}
.category-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.category-row {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 12px 14px;
}
.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.cat-badge {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
}
.cat-badge.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }
.cat-badge.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.cat-badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.cat-badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.cat-figures {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
}
.cat-count { color: var(--color-muted); }
.cat-amount {
  color: var(--color-ink);
  font-weight: var(--fw-semibold);
}
.bar-track {
  height: 6px;
  border-radius: 3px; /* 子元素微圆角，保持紧凑 */;
  background: var(--color-track);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 3px; /* 子元素微圆角，保持紧凑 */;
  transition: width 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
.fill-blue { background: var(--bar-blue); }
.fill-green { background: var(--bar-green); }
.fill-yellow { background: var(--bar-yellow); }
.fill-red { background: var(--bar-red); }
.badge {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
  padding: 24px 0;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
}
</style>
<style>
/* 细节轮 D-4：深色下浪费段满宽时 tone-red-fg（浅粉）偏荧光，改用更柔的 bar-red；
   浅色不变；图例小点保持 tone-red-fg 高对比 */
:root[data-theme='dark'] .usage-seg-waste {
  background: var(--bar-red);
}
</style>
