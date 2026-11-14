<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ItemDto } from '@home-stock/shared';
import { api } from '../api';
import { badgeFor } from '../lib/badges';
import { formatDateCN, todayISO } from '../lib/dates';
import { needsExpiryDate } from '../lib/needs-expiry';
import { useInventory } from '../composables/useInventory';
import { useMediaQuery } from '../composables/useMediaQuery';
import ChevronIcon from '../components/ChevronIcon.vue';
import ItemDrawer from '../components/ItemDrawer.vue';

const router = useRouter();
const {
  items,
  categories,
  searchInput,
  activeCategory,
  loading,
  error,
  onSearchInput,
  toggleCategory,
  reload,
} = useInventory();

const isDesktop = useMediaQuery('(min-width: 1024px)');

/** 桌面抽屉：当前打开的物品 id（null = 关闭） */
const drawerItemId = ref<number | null>(null);

// ---------- 状态筛选（客户端，叠加在服务端搜索/类别之上） ----------
type StatusFilter = 'all' | 'expiring' | 'expired' | 'opened' | 'none' | 'missing' | 'low';
const statusFilter = ref<StatusFilter>('all');

/**
 * 状态筛选卡（2026-11-11 审查 I-2：概览 KPI 卡直接作为筛选入口，
 * 与原状态 chips 行语义重复故删 chips 只留类别行）。label 用于卡片文案。
 */
const STATUS_CHIPS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '在库物品' },
  { key: 'expiring', label: '临期' },
  { key: 'expired', label: '已过期' },
  { key: 'opened', label: '已开封' },
  { key: 'none', label: '长期' },
  { key: 'missing', label: '待补日期' },
  { key: 'low', label: '低库存' },
];

function matchesFilter(it: ItemDto, f: StatusFilter): boolean {
  switch (f) {
    case 'expiring':
      return it.expiryStatus === 'expiring';
    case 'expired':
      return it.expiryStatus === 'expired';
    case 'opened':
      return it.opened === 1;
    case 'none':
      return it.expiryStatus === 'none' && !needsExpiryDate(it);
    case 'missing':
      return needsExpiryDate(it);
    case 'low':
      return it.minQuantity != null && it.quantity <= it.minQuantity;
    default:
      return true;
  }
}

const EXPIRY_WEIGHT = { expired: 0, expiring: 1, ok: 2, none: 3 } as const;

/** 临期优先排序：状态权重 → 有效过期日升序（空靠后）→ 名称 */
function sortItems(list: ItemDto[]): ItemDto[] {
  return [...list].sort((a, b) => {
    const w = EXPIRY_WEIGHT[a.expiryStatus] - EXPIRY_WEIGHT[b.expiryStatus];
    if (w !== 0) return w;
    const da = a.effectiveExpiryDate;
    const db = b.effectiveExpiryDate;
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da !== db) return da ? -1 : db ? 1 : 0;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

const displayed = computed(() =>
  sortItems(items.value.filter((it) => matchesFilter(it, statusFilter.value))),
);

// ---------- D-6b 同名聚合（桌面表格）：多批次合成组行，可展开批次 ----------
export interface DisplayGroup {
  key: string;
  name: string;
  /** 单批次组直接渲染普通行 */
  batches: ItemDto[];
  isMulti: boolean;
}

const expandedNames = ref<Set<string>>(new Set());

const displayGroups = computed<DisplayGroup[]>(() => {
  const groups = new Map<string, ItemDto[]>();
  for (const it of displayed.value) {
    const list = groups.get(it.name) ?? [];
    list.push(it);
    groups.set(it.name, list);
  }
  return [...groups.entries()].map(([name, list]) => ({
    key: name,
    name,
    batches: sortItems(list),
    isMulti: list.length > 1,
  }));
});

function isExpanded(name: string): boolean {
  return expandedNames.value.has(name);
}

function toggleGroup(name: string): void {
  const next = new Set(expandedNames.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  expandedNames.value = next;
}

/** 组内最早到期文案（组行展示用） */
function earliestDaysText(batches: ItemDto[]): string {
  const dates = batches
    .map((b) => b.effectiveExpiryDate)
    .filter((d): d is string => d !== null);
  if (dates.length === 0) return '长期';
  const earliest = dates.reduce((min, d) => (d < min ? d : min));
  const left = Math.round(
    (Date.parse(`${earliest}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000,
  );
  if (left < 0) return `含已过期`;
  if (left === 0) return '今天到期';
  return `最早剩 ${left} 天`;
}

function groupQuantity(batches: ItemDto[]): string {
  const total = batches.reduce((sum, b) => sum + b.quantity, 0);
  const unit = batches[0]?.unit ?? '';
  const q = Math.round(total * 100) / 100;
  return `${q}${unit ? ` ${unit}` : ''}`;
}

function setFilter(f: StatusFilter): void {
  statusFilter.value = f;
}

// ---------- 概览（全量在库，与搜索/筛选解耦） ----------
const allItems = ref<ItemDto[]>([]);

async function loadOverview(): Promise<void> {
  try {
    allItems.value = await api.listItems();
  } catch {
    /* 概览失败不阻塞列表 */
  }
}

/** D-M2：没有任何价格数据时总价值显「—」而不是误导性的 ¥0.00（对齐总览 D-17） */
const hasAnyPrice = computed(() => allItems.value.some((it) => it.price !== null));

const overview = computed(() => {
  const list = allItems.value;
  const count = (f: StatusFilter): number => list.filter((it) => matchesFilter(it, f)).length;
  const value = list.reduce((sum, it) => sum + (it.price ?? 0) * (it.quantity ?? 0), 0);
  return {
    total: list.length,
    expiring: count('expiring'),
    expired: count('expired'),
    opened: count('opened'),
    missing: count('missing'),
    low: count('low'),
    value: Math.round((value + Number.EPSILON) * 100) / 100,
  };
});

const STATUS_COUNT_KEYS = {
  all: 'total',
  expiring: 'expiring',
  expired: 'expired',
  opened: 'opened',
  none: 'none',
  missing: 'missing',
  low: 'low',
} as const;

function chipCount(key: StatusFilter): number {
  const k = STATUS_COUNT_KEYS[key];
  return k === 'none'
    ? allItems.value.filter((it) => it.expiryStatus === 'none' && !needsExpiryDate(it)).length
    : overview.value[k];
}

// ---------- 操作 ----------
/** 详情入口分流：桌面开抽屉（不丢列表上下文），移动端进详情全页（M1.6 归档入口） */
function openDetail(item: ItemDto): void {
  if (isDesktop.value) {
    drawerItemId.value = item.id;
  } else {
    void router.push(`/items/${item.id}`);
  }
}

/** 抽屉关闭（Esc/遮罩/✕） */
function closeDrawer(): void {
  drawerItemId.value = null;
}

/** 抽屉内删除 → 关抽屉并刷新列表与概览 */
function onDrawerDeleted(): void {
  drawerItemId.value = null;
  void reload();
  void loadOverview();
}

/** 抽屉内变更（开封/步进/归档/恢复）→ 刷新列表与概览统计 */
function onDrawerChanged(): void {
  void reload();
  void loadOverview();
}

/** M5.3：仅「待补过期日」徽章/CTA 进编辑页补填 */
function goEdit(item: ItemDto): void {
  void router.push(`/items/${item.id}/edit`);
}

/** 行内快捷开封/取消开封（server 自动维护 openedAt），就地替换避免整表刷新 */
/** I-2：行内步进 in-flight 守卫（busy 期间按钮 :disabled 关闭丢失窗口） */
const stepBusyIds = ref(new Set<number>());
function isStepping(id: number): boolean {
  return stepBusyIds.value.has(id);
}

/** D-14：行内数量步进 ±1，就地更新列表与概览 */
async function stepQuantity(item: ItemDto, delta: number): Promise<void> {
  if (isStepping(item.id)) return;
  const next = Math.round((item.quantity + delta) * 100) / 100;
  if (next < 0) return;
  stepBusyIds.value.add(item.id);
  try {
    const updated = await api.updateItem(item.id, { quantity: next });
    const replace = (list: ItemDto[]): ItemDto[] => list.map((it) => (it.id === updated.id ? updated : it));
    items.value = replace(items.value);
    allItems.value = replace(allItems.value);
    void loadOverview();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '数量更新失败';
  } finally {
    stepBusyIds.value.delete(item.id);
  }
}

/** I-2：开封切换同款 in-flight 守卫 */
const togglingIds = ref(new Set<number>());
async function toggleOpen(item: ItemDto): Promise<void> {
  if (togglingIds.value.has(item.id)) return;
  togglingIds.value.add(item.id);
  try {
    const updated = await api.updateItem(item.id, { opened: item.opened === 1 ? 0 : 1 });
    const replace = (list: ItemDto[]): ItemDto[] =>
      list.map((it) => (it.id === updated.id ? updated : it));
    items.value = replace(items.value);
    allItems.value = replace(allItems.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '开封状态更新失败';
  } finally {
    togglingIds.value.delete(item.id);
  }
}

function daysLeftText(item: ItemDto): string {
  const expiry = item.effectiveExpiryDate;
  if (!expiry) return '长期';
  const left = Math.round(
    (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000,
  );
  if (item.expiryStatus === 'expired') return `已过期 ${Math.max(0, -left)} 天`;
  if (left === 0) return '今天到期';
  return `剩 ${left} 天`;
}

const staggerStyle = (i: number) => ({
  'animation-delay': `${Math.min(i, 8) * 60}ms`,
});

function valueOf(item: ItemDto): number {
  const v = (item.price ?? 0) * (item.quantity ?? 0);
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

onMounted(() => {
  void loadOverview();
});
</script>

<template>
  <div class="inventory wb-page" :class="{ 'in-workbench': isDesktop }">
    <header class="page-head">
      <h1 class="page-title">库存</h1>
      <div class="head-actions">
        <RouterLink class="archive-link" to="/archive">归档记录</RouterLink>
        <button v-if="isDesktop" class="add-btn" type="button" @click="router.push('/items/new')">
          ＋ 记一笔
        </button>
      </div>
    </header>

    <!-- 概览条 = 状态筛选入口（2026-11-11 审查 I-2）：点击卡片筛选，替代原状态 chips 行；
         数字为全量在库口径（与搜索/筛选解耦），「长期」计数走 chipCount 特例 -->
    <section class="overview" aria-label="库存概览与状态筛选">
      <button
        v-for="c in STATUS_CHIPS"
        :key="c.key"
        class="ov-card"
        :class="{ active: statusFilter === c.key }"
        :aria-pressed="statusFilter === c.key"
        type="button"
        @click="setFilter(c.key)"
      >
        <span class="ov-label">{{ c.label }}</span>
        <span
          class="ov-value num"
          :class="c.key === 'expiring' ? 'ov-yellow' : c.key === 'expired' ? 'ov-red' : ''"
        >{{ chipCount(c.key) }}<span class="ov-unit">件</span></span>
      </button>
      <div class="ov-card">
        <span class="ov-label">库存总价值</span>
        <span class="ov-value num">{{ hasAnyPrice ? `¥${overview.value.toFixed(2)}` : '—' }}</span>
      </div>
    </section>

    <input
      class="search-box"
      type="search"
      placeholder="搜索名称…"
      :value="searchInput"
      aria-label="搜索物品"
      @input="onSearchInput(($event.target as HTMLInputElement).value)"
    />

    <div class="chips" role="group" aria-label="类别筛选">
      <button
        class="chip"
        :class="{ active: activeCategory === null }"
        type="button"
        @click="toggleCategory(null)"
      >
        全部
      </button>
      <button
        v-for="c in categories"
        :key="c.id"
        class="chip"
        :class="{ active: activeCategory === c.id }"
        type="button"
        @click="toggleCategory(c.id)"
      >
        {{ c.name }}
      </button>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="loading && items.length === 0" class="muted-text">加载中…</p>
    <!-- 细节轮 D-5：空态卡片化（与清单/通知同语言，样式已全局化 main.css） -->
    <div v-else-if="items.length === 0" class="empty-card">
      <div class="empty-icon" aria-hidden="true">📦</div>
      <p class="empty-title">还没有物品</p>
      <p class="empty-sub">{{ isDesktop ? '点右上角「＋ 记一笔」开始' : '点右下角「记一笔」开始' }}</p>
    </div>
    <div v-else-if="displayed.length === 0" class="empty-card">
      <div class="empty-icon" aria-hidden="true">🔍</div>
      <p class="empty-title">没有符合筛选条件的物品</p>
      <p class="empty-sub">换个状态或类别筛选试试</p>
    </div>

    <!-- PC：表格化宽行 -->
    <div v-else-if="isDesktop" class="inv-table" role="list" aria-label="库存列表">
      <div class="inv-thead" aria-hidden="true">
        <span>物品</span>
        <span>类别</span>
        <span>数量</span>
        <span>到期</span>
        <span>价值</span>
        <span>状态</span>
        <span />
      </div>
      <template v-for="group in displayGroups" :key="group.key">
        <!-- D-6b：同名多批次 → 组行（默认收起，点开展开批次行） -->
        <div
          v-if="group.isMulti"
          class="inv-row inv-group-row"
          role="listitem"
        >
          <button
            class="inv-name-btn inv-group-toggle"
            type="button"
            :aria-expanded="isExpanded(group.name)"
            @click="toggleGroup(group.name)"
          >
            <span class="inv-group-chevron" aria-hidden="true"><ChevronIcon :rotate="isExpanded(group.name) ? 90 : 0" /></span>
            <span class="inv-name-wrap">
              <span class="item-name">{{ group.name }}<em class="inv-batches">（{{ group.batches.length }} 批）</em></span>
              <span class="inv-sub">共 {{ groupQuantity(group.batches) }}</span>
            </span>
          </button>
          <span class="inv-cat">{{ categories.find((c) => c.id === group.batches[0].categoryId)?.name ?? '未分类' }}</span>
          <span class="num inv-cell">{{ groupQuantity(group.batches) }}</span>
          <span class="num inv-expiry">{{ earliestDaysText(group.batches) }}</span>
          <span class="num inv-cell">{{ `¥${(Math.round(group.batches.reduce((s, b) => s + valueOf(b), 0) * 100) / 100).toFixed(2)}` }}</span>
          <span class="badge gray-badge">{{ group.batches.length }} 批</span>
          <span />
        </div>
        <template v-if="group.isMulti && isExpanded(group.name)">
          <div
            v-for="item in group.batches"
            :key="`${group.key}-${item.id}`"
            class="inv-row inv-batch-row"
            role="listitem"
          >
            <button class="inv-name-btn" type="button" :aria-label="`查看批次 ${item.name}`" @click="openDetail(item)">
              <span class="inv-name-wrap" style="padding-left: 14px">
                <span class="item-name num">{{ formatDateCN(item.effectiveExpiryDate ?? item.expiryDate) }}</span>
                <span class="inv-sub num">{{ item.quantity }}{{ item.unit ? ` ${item.unit}` : '' }} · 到期 {{ item.effectiveExpiryDate ?? '—' }}</span>
              </span>
            </button>
            <span class="inv-cat">{{ categories.find((c) => c.id === item.categoryId)?.name ?? '未分类' }}</span>
            <span class="num inv-cell qty-step">
              <button class="qty-step-btn" type="button" :aria-label="`扣减 ${item.name}`" :disabled="isStepping(item.id)" @click.stop="stepQuantity(item, -1)">−</button>
              <span class="qty-step-val">{{ item.quantity }}{{ item.unit ? ` ${item.unit}` : '' }}</span>
              <button class="qty-step-btn" type="button" :aria-label="`增加 ${item.name}`" :disabled="isStepping(item.id)" @click.stop="stepQuantity(item, 1)">＋</button>
            </span>
            <span class="num inv-expiry">
              <template v-if="item.effectiveExpiryDate">{{ daysLeftText(item) }}</template>
              <template v-else>长期</template>
            </span>
            <!-- 批次行同口径：价值列显示该批次总额（审查 I-1） -->
            <span class="num inv-cell">{{ valueOf(item) > 0 ? `¥${valueOf(item).toFixed(2)}` : '—' }}</span>
            <span class="badge" :class="`tone-${badgeFor(item.expiryStatus, item.opened).tone}`">
              {{ badgeFor(item.expiryStatus, item.opened).text }}
            </span>
            <button
              class="open-toggle"
              type="button"
              :aria-label="item.opened === 1 ? `取消开封 ${item.name}` : `开封 ${item.name}`"
              :disabled="togglingIds.has(item.id)"
              @click="toggleOpen(item)"
            >
              {{ item.opened === 1 ? '取消开封' : '开封' }}
            </button>
          </div>
        </template>
        <div
          v-else
          class="inv-row"
          :class="{
            'row-expired': group.batches[0].expiryStatus === 'expired',
            'row-expiring': group.batches[0].expiryStatus === 'expiring',
          }"
          role="listitem"
        >
          <button class="inv-name-btn" type="button" :aria-label="`查看 ${group.batches[0].name}`" @click="openDetail(group.batches[0])">
            <span
              class="avatar"
              :class="`tone-${badgeFor(group.batches[0].expiryStatus, group.batches[0].opened).tone}`"
              aria-hidden="true"
            >
              {{ group.batches[0].name.slice(0, 1) }}
            </span>
            <span class="inv-name-wrap">
              <span class="item-name">{{ group.batches[0].name }}</span>
              <span class="inv-sub">
                <!-- 2026-11-11 审查 I-1：名称副标改单价（总额归「价值」列，语义对齐） -->
                {{ group.batches[0].price != null ? `¥${group.batches[0].price}${group.batches[0].unit ? ` / ${group.batches[0].unit}` : ''}` : '' }}
                <em v-if="group.batches[0].minQuantity != null && group.batches[0].quantity <= group.batches[0].minQuantity" class="inv-low">低于最少库存</em>
              </span>
            </span>
          </button>
          <span class="inv-cat">{{ categories.find((c) => c.id === group.batches[0].categoryId)?.name ?? '未分类' }}</span>
          <span class="num inv-cell">{{ group.batches[0].quantity }}{{ group.batches[0].unit ? ` ${group.batches[0].unit}` : '' }}</span>
          <span class="num inv-expiry">
            <template v-if="group.batches[0].effectiveExpiryDate">
              {{ daysLeftText(group.batches[0]) }}
              <em v-if="needsExpiryDate(group.batches[0])" class="inv-missing">待补</em>
            </template>
            <template v-else-if="needsExpiryDate(group.batches[0])">
              <em class="inv-missing">待补过期日</em>
            </template>
            <template v-else>长期</template>
          </span>
          <!-- 价值列 = price×quantity 总额（审查 I-1：原显示单价名不符实） -->
          <span class="num inv-cell">{{ valueOf(group.batches[0]) > 0 ? `¥${valueOf(group.batches[0]).toFixed(2)}` : '—' }}</span>
          <span
            v-if="!needsExpiryDate(group.batches[0])"
            class="badge"
            :class="`tone-${badgeFor(group.batches[0].expiryStatus, group.batches[0].opened).tone}`"
          >
            {{ badgeFor(group.batches[0].expiryStatus, group.batches[0].opened).text }}
          </span>
          <span v-else class="badge tone-yellow inv-missing-badge">待补过期日</span>
          <button
            class="open-toggle"
            type="button"
            :aria-label="group.batches[0].opened === 1 ? `取消开封 ${group.batches[0].name}` : `开封 ${group.batches[0].name}`"
            :disabled="togglingIds.has(group.batches[0].id)"
            @click="toggleOpen(group.batches[0])"
          >
            {{ group.batches[0].opened === 1 ? '取消开封' : '开封' }}
          </button>
        </div>
      </template>
    </div>

    <!-- 移动端：同名聚合（I-7，与桌面 displayGroups 同数据源）——
         单批次组保持原卡片形态；多批次组卡片可展开批次行，点批次开详情 -->
    <ul v-else class="item-list">
      <template v-for="group in displayGroups" :key="group.key">
        <li
          v-if="!group.isMulti"
          class="item-card enter"
          :style="staggerStyle(0)"
        >
          <button
            class="item-card-btn"
            :class="{ 'with-hint': needsExpiryDate(group.batches[0]) }"
            type="button"
            @click="openDetail(group.batches[0])"
          >
            <span
              class="avatar"
              :class="`tone-${badgeFor(group.batches[0].expiryStatus, group.batches[0].opened).tone}`"
              aria-hidden="true"
            >
              {{ group.batches[0].name.slice(0, 1) }}
            </span>
            <span class="item-info">
              <span class="item-name">{{ group.batches[0].name }}</span>
              <span class="item-meta">
                {{ group.batches[0].quantity }}{{ group.batches[0].unit ? ` ${group.batches[0].unit}` : '' }}
                <template v-if="group.batches[0].effectiveExpiryDate"> · 有效期至 {{ formatDateCN(group.batches[0].effectiveExpiryDate) }}</template>
              </span>
            </span>
            <span
              v-if="!needsExpiryDate(group.batches[0])"
              class="badge"
              :class="`tone-${badgeFor(group.batches[0].expiryStatus, group.batches[0].opened).tone}`"
            >
              {{ badgeFor(group.batches[0].expiryStatus, group.batches[0].opened).text }}
            </span>
          </button>
          <button
            v-if="needsExpiryDate(group.batches[0])"
            class="badge tone-yellow expiry-hint"
            type="button"
            :aria-label="`补填过期日 ${group.batches[0].name}`"
            @click="goEdit(group.batches[0])"
          >
            待补过期日
          </button>
        </li>
        <li v-else class="item-card item-group enter" :style="staggerStyle(0)">
          <button
            class="item-card-btn"
            type="button"
            :aria-expanded="isExpanded(group.name)"
            @click="toggleGroup(group.name)"
          >
            <span class="avatar avatar-group" aria-hidden="true">{{ group.name.slice(0, 1) }}</span>
            <span class="item-info">
              <span class="item-name">
                {{ group.name }}<em class="inv-batches">（{{ group.batches.length }} 批）</em>
              </span>
              <span class="item-meta">
                共 {{ groupQuantity(group.batches) }}{{ group.batches[0].unit ? ` ${group.batches[0].unit}` : '' }}
                · 最近 {{ earliestDaysText(group.batches) }}
              </span>
            </span>
            <span class="inv-group-chevron" aria-hidden="true"><ChevronIcon :rotate="isExpanded(group.name) ? 90 : 0" /></span>
          </button>
          <ul v-if="isExpanded(group.name)" class="batch-list">
            <li v-for="b in group.batches" :key="b.id" class="batch-row">
              <button class="item-card-btn batch-open" type="button" @click="openDetail(b)">
                <span class="item-meta">
                  {{ b.quantity }}{{ b.unit ? ` ${b.unit}` : '' }}
                  <template v-if="b.effectiveExpiryDate"> · 有效期至 {{ formatDateCN(b.effectiveExpiryDate) }}</template>
                </span>
                <span class="badge" :class="`tone-${badgeFor(b.expiryStatus, b.opened).tone}`">
                  {{ badgeFor(b.expiryStatus, b.opened).text }}
                </span>
              </button>
            </li>
          </ul>
        </li>
      </template>
    </ul>

    <button v-if="!isDesktop" class="fab" type="button" aria-label="记一笔" @click="router.push('/items/new')">记一笔</button>

    <!-- 桌面详情抽屉：点行滑出，不丢列表上下文（移动端走 /items/:id 全页） -->
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
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.archive-link {
  font-size: 13px;
  color: var(--color-muted);
  text-decoration: none;
  border-bottom: 1px solid var(--color-border);
}
.add-btn {
  background: var(--color-ink);
  color: var(--color-on-ink);
  border: none;
  border-radius: var(--radius-m);
  padding: 8px 14px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
}

/* 概览条 = 状态筛选入口（2026-11-11 审查 I-2）：卡片可点击，激活态用双环（对齐铁律 2 语言） */
.overview {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.ov-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
button.ov-card {
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 150ms ease-out, transform 120ms ease, box-shadow 150ms ease;
}
button.ov-card:hover {
  background: var(--color-hover);
}
button.ov-card:active {
  transform: scale(0.98);
}
.ov-card.active {
  box-shadow:
    0 0 0 1.2px var(--color-ink),
    0 0 0 4.5px var(--ring-outer);
}
.ov-label {
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ov-value {
  font-size: 20px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
  line-height: 1.2;
}
.ov-unit {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 2px;
}
.ov-yellow {
  color: var(--tone-yellow-fg);
}
.ov-red {
  color: var(--tone-red-fg);
}
@media (min-width: 1024px) {
  /* 2026-11-11 审查 I-2/I-5：7 状态卡 + 总价值 = 8 卡；待补日期/低库存拆开 */
  .overview {
    grid-template-columns: repeat(8, 1fr);
  }
}

.search-box {
  width: 100%;
  max-width: 360px; /* 审查 I-4：收窄至内容比例，不再全宽拉满 */
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
  margin-bottom: 10px;
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
  transition: transform 120ms ease;
}
.chip:active {
  transform: scale(0.98);
}
.chip.active {
  background: var(--color-ink);
  border-color: var(--color-ink);
  color: var(--color-on-ink);
}

/* PC 表格化宽行 */
.inv-table {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  overflow: hidden;
}
.inv-thead {
  display: grid;
  /* 2026-11-11 审查 I-3：物品列 2.2fr→1.6fr，价值列加宽——名称短列长失衡 */
  grid-template-columns: minmax(200px, 1.6fr) 92px 100px 150px 110px 96px 92px;
  gap: 10px;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--color-muted);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-hover);
}
.inv-row {
  display: grid;
  grid-template-columns: minmax(200px, 1.6fr) 92px 100px 150px 110px 96px 92px;
  gap: 10px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-line);
}
.inv-row:last-child {
  border-bottom: none;
}
.inv-row.row-expiring {
  background: var(--color-row-expiring);
}
.inv-row.row-expired {
  background: var(--color-row-expired);
}
.inv-name-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.inv-cell {
  font-size: 13px;
}
.inv-name-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.inv-sub {
  font-size: 12px;
  color: var(--color-muted);
  display: flex;
  gap: 8px;
}
.inv-low {
  font-style: normal;
  color: var(--tone-yellow-fg);
}
.inv-cat {
  font-size: 12px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inv-expiry {
  font-size: 13px;
  white-space: nowrap;
}
.inv-missing {
  font-style: normal;
  color: var(--tone-yellow-fg);
  font-size: 12px;
}
.inv-missing-badge {
  white-space: nowrap;
}
.inv-table .avatar {
  width: 32px;
  height: 32px;
  font-size: 13px;
}
.open-toggle {
  background: var(--color-field);
  border-radius: var(--radius-s);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--color-muted);
  cursor: pointer;
  justify-self: end;
}
.open-toggle:hover {
  color: var(--color-ink);
  border-color: var(--color-ink);
}

/* 移动端卡片（保留原有） */
.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.item-card {
  position: relative;
}
.item-card-btn.with-hint {
  padding-right: 104px;
}
.expiry-hint {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  border: none;
  font-family: inherit;
  cursor: pointer;
}
.item-card-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 12px 14px;
  cursor: pointer;
  font: inherit;
  transition: transform 120ms ease;
}
.item-card-btn:active {
  transform: scale(0.98);
}
.avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: var(--fw-semibold);
}
.avatar.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.avatar.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.avatar.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.avatar.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }
.item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.item-name {
  font-size: 15px;
  font-weight: var(--fw-semibold);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-meta {
  font-size: 13px;
  color: var(--color-muted);
}
.badge {
  flex: none;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.badge.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.badge.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }
.fab {
  position: fixed;
  right: 18px;
  bottom: 76px;
  background: var(--color-ink);
  color: var(--color-on-ink);
  border: none;
  border-radius: var(--radius-s);
  padding: 12px 18px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
  box-shadow: none;
  transition: transform 120ms ease;
}
.fab:active {
  transform: scale(0.98);
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
  padding: 12px 0;
}
</style>
<style scoped>
/* D-6b 同名聚合：组行 + 批次行 */
.inv-group-row {
  background: var(--color-field);
}
.inv-group-toggle {
  cursor: pointer;
}
.inv-group-chevron {
  width: 14px;
  flex: none;
  color: var(--color-muted);
  font-size: 12px;
}
.inv-batches {
  font-style: normal;
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 4px;
}
.inv-batch-row .inv-name-wrap {
  padding-left: 14px;
}
.gray-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--radius-s);
  background: var(--color-field);
  color: var(--color-muted);
  white-space: nowrap;
}

/* D-14 行内数量步进（桌面表格） */
.qty-step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.qty-step-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: var(--color-hover);
  border-radius: var(--radius-s);
  font-size: 13px;
  line-height: 1;
  color: var(--color-muted);
  cursor: pointer;
}
.qty-step-btn:hover {
  color: var(--color-ink);
}
.qty-step-val {
  min-width: 34px;
  text-align: center;
}
</style>

<style scoped>
/* I-7 移动聚合组 */
.item-group .item-card-btn {
  align-items: center;
}
.avatar-group {
  background: var(--color-field);
  color: var(--color-text);
}
.item-group .inv-batches {
  font-style: normal;
  font-size: 12px;
  color: var(--color-muted);
  margin-left: 4px;
}
.item-group .inv-group-chevron {
  flex: none;
  color: var(--color-muted);
  font-size: 12px;
}
.batch-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.batch-row .item-card-btn {
  width: 100%;
  background: var(--color-canvas);
  border-radius: var(--radius-m);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.batch-row .item-card-btn:hover {
  background: var(--color-hover);
}
</style>
