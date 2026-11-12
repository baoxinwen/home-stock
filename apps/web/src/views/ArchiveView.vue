<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { overdueDays as sharedOverdueDays, type ItemDto } from '@home-stock/shared';
import { api } from '../api';
import { archiveBadgeFor } from '../lib/badges';
import { currentPeriod, formatAmount, formatPeriodCN } from '../lib/stats';
import RestoreChoicePanel from '../components/RestoreChoicePanel.vue';
import { useItemRestore } from '../composables/useItemRestore';
import { formatDateCN, todayISO } from '../lib/dates';

const router = useRouter();

/** 返回：有历史可退则 back，否则回首页（深链/新标签直开无历史，M17 移植） */
function goBack(): void {
  const state = router.options.history.state as { back?: string | null } | null;
  if (state && state.back != null) router.back();
  else void router.push('/');
}

type ReasonFilter = 'all' | 'expired_discarded' | 'used_up';

const items = ref<ItemDto[]>([]);
const loading = ref(false);
const error = ref('');
const reasonFilter = ref<ReasonFilter>('all');
const searchInput = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    items.value = await api.listItems({ status: 'archived' });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

const displayed = computed(() => {
  const q = searchInput.value.trim().toLowerCase();
  return items.value.filter((it) => {
    if (reasonFilter.value !== 'all' && it.archivedReason !== reasonFilter.value) return false;
    if (q && !it.name.toLowerCase().includes(q)) return false;
    return true;
  });
});

/** 本月汇总：归档件数与浪费金额（与统计口径一致：仅过期丢弃计金额） */
const monthly = computed(() => {
  const period = currentPeriod();
  const rows = items.value.filter((it) => (it.archivedAt ?? '').slice(0, 7) === period);
  const wasteRows = rows.filter((it) => it.archivedReason === 'expired_discarded');
  const amount = wasteRows.reduce((sum, it) => sum + (it.price ?? 0) * (it.quantity ?? 0), 0);
  return {
    count: rows.length,
    wasted: wasteRows.length,
    amount: Math.round((amount + Number.EPSILON) * 100) / 100,
  };
});

function valueOf(item: ItemDto): number {
  const v = (item.price ?? 0) * (item.quantity ?? 0);
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function setFilter(f: ReasonFilter): void {
  reasonFilter.value = f;
}

// ---------- D-9 恢复陷阱防护：过期品恢复前给出说明与选项 ----------
interface RestoreChoice {
  item: ItemDto;
  /** 已过期天数（有效过期日早于今天的天数，≥1 才弹面板） */
  overdueDays: number;
}

const restoreChoice = ref<RestoreChoice | null>(null);
// C-1/I-4：执行语义收敛到共享 composable（顺延含清开封 + 本地口径）
const { restoringId, postponeAndRestore, forceRestore } = useItemRestore({
  onDone: async () => {
    restoreChoice.value = null;
    await load();
  },
  onError: (message) => {
    error.value = message;
  },
});

function requestRestore(item: ItemDto): void {
  error.value = '';
  const overdue = overdueDays(item);
  if (overdue >= 1) {
    // 恢复过期品：下次提醒扫描会再次自动归档（settings.auto_archive_expired），必须先告知
    restoreChoice.value = { item, overdueDays: overdue };
    return;
  }
  void forceRestore(item.id);
}

function overdueDays(item: ItemDto): number {
  return sharedOverdueDays(item.effectiveExpiryDate, todayISO());
}

const staggerStyle = (i: number) => ({ 'animation-delay': `${Math.min(i, 8) * 60}ms` });

/** 按归档月份分组倒序（2026-11-11 审查 A-1：表格化密行 + 月分组小标题，替代稀疏行卡） */
const monthGroups = computed(() => {
  const groups = new Map<string, ItemDto[]>();
  for (const it of displayed.value) {
    const month = (it.archivedAt ?? '').slice(0, 7);
    const list = groups.get(month) ?? [];
    list.push(it);
    groups.set(month, list);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([month, list]) => ({
      month,
      label: month === '' ? '日期未知' : formatPeriodCN(month),
      items: list,
    }));
});

onMounted(load);
</script>

<template>
  <div class="archive-view wb-page">
    <header class="page-head">
      <button class="back-btn" type="button" @click="goBack">‹ 返回</button>
      <h1 class="page-title">归档记录</h1>
    </header>

    <section class="summary" aria-label="本月归档汇总">
      <div class="sum-card">
        <span class="sum-label">本月归档</span>
        <span class="sum-value num">{{ monthly.count }}<span class="sum-unit">件</span></span>
      </div>
      <div class="sum-card">
        <span class="sum-label">其中过期丢弃</span>
        <span class="sum-value num sum-red">{{ monthly.wasted }}<span class="sum-unit">件</span></span>
      </div>
      <div class="sum-card">
        <span class="sum-label">本月浪费金额</span>
        <span class="sum-value num">¥{{ formatAmount(monthly.amount) }}</span>
      </div>
    </section>

    <input
      class="search-box"
      type="search"
      placeholder="搜索归档名称…"
      v-model="searchInput"
      aria-label="搜索归档"
    />

    <div class="chips" role="group" aria-label="归档原因筛选">
      <button class="chip" :class="{ active: reasonFilter === 'all' }" type="button" @click="setFilter('all')">
        全部
      </button>
      <button
        class="chip"
        :class="{ active: reasonFilter === 'expired_discarded' }"
        type="button"
        @click="setFilter('expired_discarded')"
      >
        过期丢弃
      </button>
      <button
        class="chip"
        :class="{ active: reasonFilter === 'used_up' }"
        type="button"
        @click="setFilter('used_up')"
      >
        用完
      </button>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="loading && items.length === 0" class="muted-text">加载中…</p>
    <p v-else-if="items.length === 0" class="muted-text">还没有归档记录。</p>
    <p v-else-if="displayed.length === 0" class="muted-text">没有符合筛选条件的归档记录。</p>

    <!-- 审查 A-1：按月分组表格式密行（class 名沿用 archive-card 兼容既有断言） -->
    <section v-for="(g, gi) in monthGroups" :key="g.month" class="arc-group">
      <h2 class="arc-month">
        {{ g.label }}<span class="arc-month-count num">{{ g.items.length }} 件</span>
      </h2>
      <div class="arc-table" role="list" :aria-label="`${g.label}归档记录`">
        <div class="arc-thead" aria-hidden="true">
          <span>物品</span>
          <span>原因</span>
          <span class="arc-h-val">金额</span>
          <span>归档日期</span>
          <span />
        </div>
        <div
          v-for="(item, i) in g.items"
          :key="item.id"
          class="archive-card enter"
          :style="staggerStyle(gi * 2 + i)"
          role="listitem"
        >
          <span class="arc-name">{{ item.name }}</span>
          <span>
            <span class="badge" :class="`tone-${archiveBadgeFor(item.archivedReason).tone}`">
              {{ archiveBadgeFor(item.archivedReason).text }}
            </span>
          </span>
          <span class="a-value num">{{ valueOf(item) > 0 ? `¥${formatAmount(valueOf(item))}` : '—' }}</span>
          <span class="a-date num">{{ item.archivedAt ? formatDateCN(item.archivedAt.slice(0, 10)) : '—' }}</span>
          <button class="btn-restore" type="button" @click="requestRestore(item)">恢复</button>
        </div>
      </div>
    </section>

    <!-- D-9/I-4 恢复陷阱防护：面板抽为共享组件（详情/抽屉同语义） -->
    <RestoreChoicePanel
      v-if="restoreChoice"
      :item="restoreChoice.item"
      :overdue-days="restoreChoice.overdueDays"
      :restoring="restoringId !== null"
      @close="restoreChoice = null"
      @postpone="postponeAndRestore(restoreChoice.item.id)"
      @force="forceRestore(restoreChoice.item.id)"
    />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px; /* 2026-11-11 审查 G-2：二级页标题与列表页统一左对齐 */
  margin-bottom: 16px;
}
.back-btn {
  background: none;
  border: none;
  font: inherit;
  font-size: 14px;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
  border-bottom: 1px solid var(--color-border);
}
/* 汇总条 */
.summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.sum-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sum-label {
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sum-value {
  font-size: 20px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}
.sum-unit {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 2px;
}
.sum-red {
  color: var(--tone-red-fg);
}
.search-box {
  width: 100%;
  max-width: 360px; /* 与库存页 I-4 同口径：搜索框不再全宽拉满 */
  padding: 10px 14px;
  border-radius: var(--radius-m);
  background: var(--color-surface);
  font: inherit;
  color: var(--color-text);
  margin-bottom: 12px;
}
.search-box:focus {
  outline-offset: -1px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.chip {
  height: var(--control-h);
  display: inline-flex;
  align-items: center;
  background: var(--color-surface);
  border-radius: var(--radius-s);
  padding: 5px 12px;
  font-size: 13px;
  color: var(--color-muted);
  cursor: pointer;
}
.chip.active {
  background: var(--color-ink);
  border-color: var(--color-ink);
  color: var(--color-on-ink);
}
/* 按月分组表格式密行（审查 A-1） */
.arc-group {
  margin-bottom: 18px;
}
.arc-month {
  font-size: 14px;
  color: var(--color-muted);
  font-weight: var(--fw-semibold);
  margin: 0 0 8px;
}
.arc-month-count {
  font-weight: var(--fw-normal);
  margin-left: 8px;
  font-size: 12px;
}
.arc-table {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  overflow: hidden;
}
.arc-thead,
.archive-card {
  display: grid;
  grid-template-columns: minmax(160px, 2fr) 110px 110px 140px 84px;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
}
.arc-thead {
  font-size: 12px;
  color: var(--color-muted);
  background: var(--color-hover);
  border-bottom: 1px solid var(--color-border);
}
.archive-card {
  font-size: 14px;
  border-bottom: 1px solid var(--color-line);
}
.archive-card:last-child {
  border-bottom: none;
}
.arc-h-val,
.a-value {
  text-align: right;
}
.a-value {
  font-size: 13px;
  color: var(--color-text);
}
.arc-name {
  font-weight: var(--fw-semibold);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.badge.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.a-date {
  font-size: 13px;
  color: var(--color-muted);
}
.btn-restore {
  background: var(--color-field);
  border-radius: var(--radius-s);
  padding: 8px 14px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  transition: transform 120ms ease;
}
.btn-restore:active {
  transform: scale(0.98);
}
@media (max-width: 767px) {
  /* 窄屏退化为两行网格：名称+原因 / 金额+日期+恢复 */
  .arc-thead {
    display: none;
  }
  .arc-thead,
  .archive-card {
    grid-template-columns: 1fr auto auto;
    grid-template-areas:
      'name reason reason'
      'value date actions';
  }
  .archive-card {
    row-gap: 4px;
    padding: 10px 14px;
  }
  .arc-name { grid-area: name; }
  .archive-card .badge { grid-area: reason; justify-self: start; }
  .a-value { grid-area: value; text-align: left; }
  .a-date { grid-area: date; }
  .btn-restore { grid-area: actions; justify-self: end; }
}
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
