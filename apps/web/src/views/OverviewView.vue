<script setup lang="ts">
/**
 * 总览仪表盘（首页，仪表盘方向 2026-11-08）：
 * - KPI 行：库存总价值 / 30 天内到期 / 本月浪费（对比上月）/ 待购清单（预计花费）
 * - 浪费趋势（近 6 月）、临期提醒、库存明细（按类别分组密行）、类别价值分布、最近动态
 * - 基础数据挂载时并行拉取一次；库存列表的完整筛选/排序在 /inventory，这里只做总览与跳转
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import type { CategoryDto, ItemDto, ShoppingItemDto, WasteStatsDto } from '@home-stock/shared';
import { api } from '../api';
import { badgeFor, archiveBadgeFor } from '../lib/badges';
import { todayISO } from '../lib/dates';
import { useMediaQuery } from '../composables/useMediaQuery';
import ItemDrawer from '../components/ItemDrawer.vue';
import {
  currentPeriod,
  expiringWithin,
  formatAmount,
  shiftPeriod,
  stockOverview,
  usageSplit,
  wasteTrend,
} from '../lib/stats';
import WasteTrendChart from '../components/WasteTrendChart.vue';
import ExpiringList from '../components/ExpiringList.vue';
import CategoryDonut from '../components/CategoryDonut.vue';

const TREND_MONTHS = 6;
const EXPIRING_WINDOW_DAYS = 30;
const FEED_LIMIT = 6;

const loading = ref(true);
const router = useRouter();
const isDesktop = useMediaQuery('(min-width: 1024px)');

/** 桌面抽屉：明细行点开的物品 id（null = 关闭）；移动端保持跳详情全页 */
const drawerItemId = ref<number | null>(null);

function openRow(item: ItemDto): void {
  if (isDesktop.value) {
    drawerItemId.value = item.id;
  } else {
    void router.push(`/items/${item.id}`);
  }
}

function closeDrawer(): void {
  drawerItemId.value = null;
}

function onDrawerChanged(): void {
  void load();
}

function onDrawerDeleted(): void {
  drawerItemId.value = null;
  void load();
}
const error = ref('');

const active = ref<ItemDto[]>([]);
const archived = ref<ItemDto[]>([]);
const categories = ref<CategoryDto[]>([]);
const pendingShopping = ref<ShoppingItemDto[]>([]);
const wasteStats = ref<WasteStatsDto | null>(null);

const catNameOf = (id: number | null): string =>
  categories.value.find((c) => c.id === id)?.name ?? '未分类';

// ---------- KPI ----------
const overview = computed(() => stockOverview(active.value));
/** D-17：没有任何价格数据时总价值显示「—」而不是误导性的 ¥0.00 */
const hasAnyPrice = computed(() => active.value.some((it) => it.price !== null));

const expiringList = computed(() =>
  expiringWithin(active.value, todayISO(), EXPIRING_WINDOW_DAYS),
);
const expiringOpened = computed(() => expiringList.value.filter((e) => e.item.opened === 1).length);

const prevWaste = computed(() =>
  usageSplit(archived.value, shiftPeriod(currentPeriod(), -1)).wasted,
);

const pendingTotal = computed(() => {
  const sum = pendingShopping.value.reduce(
    (acc, s) => acc + (s.price ?? 0) * (s.quantity ?? 0),
    0,
  );
  return Math.round((sum + Number.EPSILON) * 100) / 100;
});

// ---------- 模块数据 ----------
const trend = computed(() => wasteTrend(archived.value, TREND_MONTHS, currentPeriod()));

const stockCats = computed(() =>
  overview.value.byCategory.map((b) => ({
    key: String(b.categoryId ?? 'uncategorized'),
    name: catNameOf(b.categoryId),
    count: b.count,
    value: b.value,
  })),
);

/** 库存明细：按类别分组，组内临期优先（与库存页同排序口径的轻量版） */
const EXPIRY_WEIGHT = { expired: 0, expiring: 1, ok: 2, none: 3 } as const;
const detailGroups = computed(() => {
  const groups = new Map<number | null, { key: string; name: string; items: ItemDto[] }>();
  for (const it of active.value) {
    const key = it.categoryId ?? null;
    const group = groups.get(key) ?? { key: String(key ?? 'uncategorized'), name: catNameOf(key), items: [] };
    group.items.push(it);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => {
      const sorted = [...g.items].sort((a, b) => {
        const w = EXPIRY_WEIGHT[a.expiryStatus] - EXPIRY_WEIGHT[b.expiryStatus];
        if (w !== 0) return w;
        const da = a.effectiveExpiryDate;
        const db = b.effectiveExpiryDate;
        if (da && db && da !== db) return da < db ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });
      return { ...g, items: sorted };
    })
    .sort((a, b) => b.items.length - a.items.length);
});

/** O-1（2026-11-13 细节轮）：明细限前 8 条——总览是摘要层，全量在库存页；
 *  跨组累计截断（组内不足时下一个组补足），剩余件数在尾部提示 */
const DETAIL_LIMIT = 8;
const visibleDetailGroups = computed(() => {
  let quota = DETAIL_LIMIT;
  const out: { key: string; name: string; items: ItemDto[] }[] = [];
  for (const g of detailGroups.value) {
    if (quota <= 0) break;
    const items = g.items.slice(0, quota);
    out.push({ ...g, items });
    quota -= items.length;
  }
  return out;
});
const detailHidden = computed(() => Math.max(0, active.value.length - DETAIL_LIMIT));

/** 最近动态：归档记录按时间倒序 */
const feed = computed(() =>
  [...archived.value]
    .filter((it) => it.archivedAt)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
    .slice(0, FEED_LIMIT),
);

function daysLeftText(item: ItemDto): string {
  const expiry = item.effectiveExpiryDate;
  if (!expiry) return '长期';
  const left = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000,
  );
  if (item.expiryStatus === 'expired') return `过期 ${Math.max(0, -left)} 天`;
  if (left === 0) return '今天到期';
  return `剩 ${left} 天`;
}

function valueOf(item: ItemDto): number {
  const v = (item.price ?? 0) * (item.quantity ?? 0);
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function feedDate(iso: string): string {
  return iso.slice(5, 10).replace('-', '/');
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [activeList, archivedList, catList, shopping, waste] = await Promise.all([
      api.listItems(),
      api.listItems({ status: 'archived' }),
      api.listCategories(),
      api.listShoppingItems('pending'),
      api.getWasteStats(),
    ]);
    active.value = activeList;
    archived.value = archivedList;
    categories.value = catList;
    pendingShopping.value = shopping;
    wasteStats.value = waste;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请重试';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="overview wb-page">
    <header class="page-head">
      <h1 class="page-title">总览</h1>
    </header>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="muted-text">加载中…</p>

    <template v-else>
      <!-- KPI 行 -->
      <section class="kpi-row" aria-label="总览指标">
        <div class="kpi-card enter">
          <span class="kpi-label">库存总价值</span>
          <span class="kpi-value num">{{ hasAnyPrice ? `¥${formatAmount(overview.value)}` : '—' }}</span>
          <span class="kpi-sub">{{ overview.count }} 件在库<span v-if="!hasAnyPrice && overview.count > 0"> · 未录价格</span></span>
        </div>
        <div class="kpi-card enter" style="animation-delay: 40ms">
          <span class="kpi-label">{{ EXPIRING_WINDOW_DAYS }} 天内到期</span>
          <span class="kpi-value num kpi-yellow">{{ expiringList.length }}<span class="kpi-unit">件</span></span>
          <span class="kpi-sub">其中 {{ expiringOpened }} 件已开封</span>
        </div>
        <div class="kpi-card enter" style="animation-delay: 80ms">
          <span class="kpi-label">本月浪费</span>
          <span class="kpi-value num kpi-red">¥{{ formatAmount(wasteStats?.totalAmount ?? 0) }}</span>
          <span class="kpi-sub">{{ wasteStats?.totalCount ?? 0 }} 件 · 上月 ¥{{ formatAmount(prevWaste.amount) }}</span>
        </div>
        <div class="kpi-card enter" style="animation-delay: 120ms">
          <span class="kpi-label">待购清单</span>
          <span class="kpi-value num">{{ pendingShopping.length }}<span class="kpi-unit">项</span></span>
          <span class="kpi-sub">预计 ¥{{ formatAmount(pendingTotal) }}</span>
        </div>
      </section>

      <!-- 趋势 + 临期 -->
      <section class="row-2" aria-label="浪费趋势与临期提醒">
        <div class="panel enter" style="animation-delay: 140ms">
          <h2 class="panel-title">浪费趋势</h2>
          <p class="panel-sub">近 {{ TREND_MONTHS }} 个月每月浪费金额（仅过期丢弃计入，用完不算）</p>
          <WasteTrendChart :buckets="trend" :current-period="currentPeriod()" />
          <div class="panel-more"><RouterLink to="/stats">查看统计 →</RouterLink></div>
        </div>
        <div class="panel enter" style="animation-delay: 180ms">
          <h2 class="panel-title">
            临期提醒
            <span class="badge tone-yellow">未来 {{ EXPIRING_WINDOW_DAYS }} 天</span>
          </h2>
          <ExpiringList :entries="expiringList" :window-days="EXPIRING_WINDOW_DAYS" show-all-link />
        </div>
      </section>

      <!-- 库存明细 +（类别价值 / 动态） -->
      <section class="cols" aria-label="库存明细与动态">
        <div class="panel enter" style="animation-delay: 200ms">
          <h2 class="panel-title">
            库存明细
            <span class="panel-sub-inline">按类别分组 · 临期优先</span>
            <RouterLink class="panel-link" to="/inventory">全部库存 →</RouterLink>
          </h2>
          <p v-if="active.length === 0" class="panel-empty">
            还没有物品，<RouterLink to="/items/new">记一笔</RouterLink>开始。
          </p>
          <div v-for="g in visibleDetailGroups" :key="g.key" class="ov-group">
            <div class="ov-group-head">
              <span class="ov-group-name">{{ g.name }}</span>
              <span class="ov-group-meta">{{ g.items.length }} 件</span>
            </div>
            <a
              v-for="item in g.items"
              :key="item.id"
              class="ov-row"
              :href="`/items/${item.id}`"
              :aria-label="`查看 ${item.name}`"
              @click.prevent="openRow(item)"
            >
              <span class="ov-name">{{ item.name }}</span>
              <span class="num ov-qty">{{ item.quantity }}{{ item.unit ? ` ${item.unit}` : '' }}</span>
              <span class="num ov-days" :class="{ 'ov-days-warn': item.expiryStatus === 'expiring', 'ov-days-late': item.expiryStatus === 'expired' }">
                {{ daysLeftText(item) }}
              </span>
              <span class="badge" :class="`tone-${badgeFor(item.expiryStatus, item.opened).tone}`">
                {{ badgeFor(item.expiryStatus, item.opened).text }}
              </span>
              <span class="num ov-value">¥{{ formatAmount(valueOf(item)) }}</span>
            </a>
          </div>
          <!-- O-1：尾部剩余提示（明细是摘要层，全量去库存页） -->
          <RouterLink v-if="detailHidden > 0" class="ov-more" to="/inventory">
            还有 {{ detailHidden }} 件，去全部库存 →
          </RouterLink>
        </div>
        <div class="side-col">
          <div class="panel enter" style="animation-delay: 220ms">
            <h2 class="panel-title">类别价值分布</h2>
            <CategoryDonut :buckets="stockCats" />
          </div>
          <div class="panel enter" style="animation-delay: 240ms">
            <h2 class="panel-title">最近动态</h2>
            <p v-if="feed.length === 0" class="panel-empty">暂无归档记录</p>
            <ul v-else class="feed">
              <li v-for="it in feed" :key="it.id" class="feed-item">
                <span class="feed-date num">{{ feedDate(it.archivedAt ?? '') }}</span>
                <span class="feed-text">
                  {{ it.name }}
                  <span class="badge" :class="`tone-${archiveBadgeFor(it.archivedReason).tone}`">
                    {{ archiveBadgeFor(it.archivedReason).text }}
                  </span>
                  <template v-if="valueOf(it) > 0"> · ¥{{ formatAmount(valueOf(it)) }}</template>
                </span>
              </li>
            </ul>
            <div class="panel-more"><RouterLink to="/archive">全部归档记录 →</RouterLink></div>
          </div>
        </div>
      </section>
    </template>

    <!-- 桌面详情抽屉：明细行点开，不离开总览 -->
    <ItemDrawer
      v-if="isDesktop && drawerItemId !== null"
      :item-id="drawerItemId"
      @close="closeDrawer"
      @deleted="onDrawerDeleted"
      @changed="onDrawerChanged"
    />
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: 16px;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  text-align: center;
  padding: 24px 0;
}

/* KPI */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}
.kpi-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.kpi-label {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--color-muted);
}
.kpi-value {
  font-size: 26px;
  line-height: 1.15;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-unit {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 3px;
}
.kpi-sub {
  font-size: 12px;
  color: var(--color-muted);
}
.kpi-yellow {
  color: var(--tone-yellow-fg);
}
.kpi-red {
  color: var(--tone-red-fg);
}
@media (min-width: 1024px) {
  .kpi-row {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* 布局网格 */
.row-2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
.cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.side-col {
  display: grid;
  gap: 12px;
  align-content: start;
}
@media (min-width: 1024px) {
  .row-2 {
    grid-template-columns: 1.6fr 1fr;
  }
  .cols {
    grid-template-columns: 1.9fr 1fr;
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
  flex-wrap: wrap;
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
.panel-link {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-muted);
  text-decoration: none;
}
.panel-link:hover {
  color: var(--color-ink);
}
.panel-empty {
  font-size: 13px;
  color: var(--color-muted);
  padding: 14px 0 6px;
  margin: 0;
}
.panel-empty a {
  color: var(--color-ink);
}
.panel-more {
  margin-top: 10px;
  text-align: right;
}
.panel-more a {
  font-size: 12px;
  color: var(--color-muted);
  text-decoration: none;
}

/* 库存明细分组密行 */
.ov-group {
  margin-bottom: 12px;
}
.ov-group:last-child {
  margin-bottom: 0;
}
.ov-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 4px;
}
.ov-group-name {
  font-size: 13px;
  font-weight: var(--fw-semibold);
  color: var(--color-text);
}
.ov-group-meta {
  font-size: 12px;
  color: var(--color-muted);
}
/* O-1：明细尾部剩余提示 */
.ov-more {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-muted);
  text-decoration: none;
  transition: color 150ms ease-out;
}
.ov-more:hover {
  color: var(--color-ink);
}
.ov-row {
  display: grid;
  grid-template-columns: minmax(110px, 2fr) 70px 96px 76px 72px;
  gap: 8px;
  align-items: center;
  background: var(--color-surface);
  padding: 7px 12px;
  font-size: 13px;
  color: var(--color-text);
  text-decoration: none;
}
.ov-row:first-of-type {
  border-radius: 8px 8px 0 0;
}
.ov-row:last-of-type {
  border-radius: 0 0 8px 8px;
}
.ov-row + .ov-row {
  border-top: none;
}
.ov-row:hover {
  background: var(--color-hover);
}
.ov-name {
  font-weight: var(--fw-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ov-qty {
  font-size: 12px;
  color: var(--color-muted);
}
.ov-days {
  font-size: 12px;
  color: var(--color-muted);
}
.ov-days-warn {
  color: var(--tone-yellow-fg);
}
.ov-days-late {
  color: var(--tone-red-fg);
}
.ov-value {
  font-size: 12px;
  color: var(--color-muted);
  text-align: right;
}
/* 窄屏：5 列最小宽超出视口 → 收成 名称/到期/状态 3 列，数量与金额进详情页看 */
@media (max-width: 639px) {
  .ov-row {
    grid-template-columns: minmax(0, 1fr) 88px 72px;
    gap: 6px;
  }
  .ov-qty,
  .ov-value {
    display: none;
  }
}
.badge {
  justify-self: start;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--radius-s);
  white-space: nowrap;
}
.badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.badge.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.badge.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }

/* 最近动态 */
.feed {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.feed-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  padding: 8px 10px;
  background: var(--color-canvas);
  border-radius: var(--radius-m);
}
.feed-date {
  color: var(--color-muted);
  font-size: 12px;
  flex: none;
}
.feed-text {
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
</style>
