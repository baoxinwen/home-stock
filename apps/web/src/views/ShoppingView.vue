<script setup lang="ts">
/**
 * 购物清单（M5.1/M5.2 + PC 充实化）：待购/已完成分区、添加、勾选流转、转库存、清空已完成、
 * 预计花费合计、已完成区折叠、低库存补货建议（minQuantity 联动）。
 * converted 项不在主视图展示，仅用于「清空已完成」。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { CategoryDto, ItemDto, ShoppingItemDto } from '@home-stock/shared';
import { api } from '../api';
import ChevronIcon from '../components/ChevronIcon.vue';
import { formatAmount } from '../lib/stats';

const router = useRouter();
const items = ref<ShoppingItemDto[]>([]);
const categories = ref<CategoryDto[]>([]);
const stockItems = ref<ItemDto[]>([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const confirmingClear = ref(false);
// 审查 L-2：已完成区默认折叠——待购 0 时页面重心全是历史记录（点开展开）
const doneCollapsed = ref(true);

const name = ref('');
const quantity = ref<number | string>(1);
const unit = ref('');
const price = ref<number | string>('');
const categoryId = ref<number | string>('');

const pendingItems = computed(() => items.value.filter((s) => s.status === 'pending'));
const doneItems = computed(() => items.value.filter((s) => s.status === 'done'));
const convertedCount = computed(() => items.value.filter((s) => s.status === 'converted').length);

/** 预计花费合计：待购项 Σ(price×quantity)，未填价格记 0 */
const pendingTotal = computed(() => {
  const sum = pendingItems.value.reduce(
    (acc, s) => acc + (s.price ?? 0) * (s.quantity ?? 0),
    0,
  );
  return Math.round((sum + Number.EPSILON) * 100) / 100;
});

/** 低库存建议（I-5，规格 S1「数量 ≤ 阈值」）：在库品 quantity <= minQuantity，且未重复出现在待购清单 */
const lowStockSuggestions = computed(() => {
  const pendingNames = new Set(pendingItems.value.map((s) => s.name));
  return stockItems.value.filter(
    (it) =>
      it.minQuantity != null &&
      it.quantity <= it.minQuantity &&
      !pendingNames.has(it.name),
  );
});

function suggestionQty(it: ItemDto): number {
  const deficit = (it.minQuantity ?? 0) - it.quantity;
  return Math.max(1, Math.round(deficit * 100) / 100);
}

async function addSuggestion(it: ItemDto): Promise<void> {
  await run(
    () =>
      api.createShoppingItem({
        name: it.name,
        quantity: suggestionQty(it),
        unit: it.unit,
        price: it.price,
        categoryId: it.categoryId,
      }),
    `已把「${it.name}」加入清单`,
  );
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    items.value = await api.listShoppingItems();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载清单失败';
  } finally {
    loading.value = false;
  }
}

async function loadStock(): Promise<void> {
  try {
    stockItems.value = await api.listItems();
  } catch {
    /* 低库存建议失败不阻塞清单 */
  }
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** W-M3：添加 in-flight 守卫——挂起中按钮禁用，快速双击不重复创建 */
const adding = ref(false);

async function add(): Promise<void> {
  if (adding.value) return;
  const trimmed = name.value.trim();
  if (!trimmed) {
    error.value = '请先填写名称';
    return;
  }
  const qty = typeof quantity.value === 'number' ? quantity.value : Number(quantity.value);
  const priceNum = price.value === '' ? null : Number(price.value);
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
    error.value = '单价必须为 >= 0 的数字';
    return;
  }
  const categoryNum = categoryId.value === '' ? null : Number(categoryId.value);
  error.value = '';
  notice.value = '';
  confirmingClear.value = false;
  adding.value = true;
  try {
    await api.createShoppingItem({
      name: trimmed,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit: unit.value.trim() || null,
      price: priceNum,
      categoryId: categoryNum,
    });
    name.value = '';
    quantity.value = 1;
    unit.value = '';
    price.value = '';
    categoryId.value = '';
    await load();
  } catch (e) {
    error.value = messageOf(e, '添加失败，请重试');
  } finally {
    adding.value = false;
  }
}

/** 跑一个清单动作：成功重拉列表返回 true，失败置错误返回 false（M16 需要区分成败回弹输入框） */
async function run(action: () => Promise<unknown>, success = ''): Promise<boolean> {
  error.value = '';
  notice.value = '';
  confirmingClear.value = false;
  try {
    await action();
    notice.value = success;
    await load();
    return true;
  } catch (e) {
    error.value = messageOf(e, '操作失败，请重试');
    return false;
  }
}

function toggle(item: ShoppingItemDto): void {
  const status = item.status === 'pending' ? 'done' : 'pending';
  void run(() => api.updateShoppingItem(item.id, { status }));
}

/** M5.1 修改数量：失焦/回车提交，非法值回落原数量；提交失败把输入框回弹为当前值（M16） */
function updateQuantity(item: ShoppingItemDto, event: Event): void {
  const input = event.target as HTMLInputElement;
  const raw = Number(input.value);
  const quantity = Number.isFinite(raw) && raw > 0 ? raw : item.quantity;
  if (quantity === item.quantity) return;
  void run(() => api.updateShoppingItem(item.id, { quantity })).then((ok) => {
    if (!ok) input.value = String(item.quantity);
  });
}

/**
 * 单件转库存（表单确认范式）：跳录入页预填清单项字段，用户选过期方式后保存，
 * 保存即按表单内容入库 + 清单项 converted（convert 接口带 payload，原子完成）。
 * 返回/取消不动清单项，可重试。批量「全部转为库存」仍走一键（convertAllDone）。
 */
function convertToStock(item: ShoppingItemDto): void {
  notice.value = '';
  error.value = '';
  confirmingClear.value = false;
  void router.push({ path: '/items/new', query: { convert: String(item.id) } });
}

/** D-4：已完成区批量转入库存，逐件调用后汇总提示（部分失败如实报数） */
const batchConverting = ref(false);

async function convertAllDone(): Promise<void> {
  if (doneItems.value.length === 0) return;
  batchConverting.value = true;
  error.value = '';
  notice.value = '';
  confirmingClear.value = false;
  let ok = 0;
  let failed = 0;
  try {
    for (const item of [...doneItems.value]) {
      try {
        await api.convertShoppingItem(item.id);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    await load();
    notice.value = failed === 0 ? `已转入 ${ok} 件库存` : `已转入 ${ok} 件，${failed} 件失败请重试`;
  } finally {
    batchConverting.value = false;
  }
}

function remove(item: ShoppingItemDto): void {
  void run(() => api.deleteShoppingItem(item.id));
}

function clearConverted(): void {
  // 二次确认：第一次点击只切换为确认态
  if (!confirmingClear.value) {
    confirmingClear.value = true;
    return;
  }
  void run(() => api.clearConvertedShoppingItems(), '已清空全部已转换项');
}

onMounted(async () => {
  void load();
  void loadStock();
  try {
    categories.value = await api.listCategories();
  } catch {
    /* 类别加载失败不阻塞清单 */
  }
});
</script>

<template>
  <div class="shopping">
    <header class="page-head">
      <h1 class="page-title">购物清单</h1>
      <span class="pending-count">
        {{ pendingItems.length }} 项待购
        <template v-if="pendingTotal > 0"> · 预计 <b class="num">¥{{ formatAmount(pendingTotal) }}</b></template>
      </span>
    </header>

    <!-- 体检表 P0-2：PC 单行网格（名称1fr/数量64/单位88/单价112/类别150/添加auto），窄屏回落两行 -->
    <form class="add-form" @submit.prevent="add">
      <input
        v-model="name"
        class="add-name"
        type="text"
        placeholder="要买什么？"
        aria-label="物品名称"
        maxlength="100"
      />
      <input
        v-model.number="quantity"
        class="add-quantity"
        type="number"
        min="1"
        step="1"
        aria-label="数量"
        placeholder="数量"
      />
      <!-- 审查 L-1：placeholder 收短防 66px/112px 列截断（可选语义保留在 aria-label） -->
      <input v-model="unit" class="add-unit" type="text" aria-label="单位（可选）" placeholder="单位" />
      <input
        v-model.number="price"
        class="add-price"
        type="number"
        min="0"
        step="0.01"
        aria-label="单价（选填，元）"
        placeholder="单价 选填"
      />
      <select v-model="categoryId" class="add-category" aria-label="类别">
        <option value="">不选类别</option>
        <option v-for="c in categories" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
      </select>
      <button class="add-submit" type="submit" :disabled="adding">添加</button>
    </form>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <!-- 单件转库存已改为跳转表单确认（按表单内容入库），批量一键完成后仅文字提示 -->
    <p v-if="notice" class="notice-text">{{ notice }}</p>

    <p v-if="loading && items.length === 0" class="muted-text">加载中…</p>
    <p v-else-if="pendingItems.length === 0 && doneItems.length === 0" class="empty-state">
      清单还是空的，添加第一件要买的东西吧。
    </p>

    <section v-if="pendingItems.length > 0" class="pending-section">
      <h2 class="section-title">待购</h2>
      <ul class="shopping-list">
        <li v-for="item in pendingItems" :key="item.id" class="shopping-item pending">
          <button class="toggle" type="button" title="标记为已完成" :aria-label="`勾选完成 ${item.name}`" @click="toggle(item)">
            ○
          </button>
          <span class="item-name">{{ item.name }}</span>
          <span class="item-meta">
            <input
              class="qty-edit"
              type="number"
              min="1"
              step="1"
              :value="item.quantity"
              :aria-label="`修改数量 ${item.name}`"
              @change="updateQuantity(item, $event)"
            />
            <template v-if="item.unit">{{ item.unit }}</template>
          </span>
          <!-- 体检表追加（可发现性）：待购行内直达转库存（跳表单确认，服务端 D-7 后 pending 可直接转换） -->
          <button class="convert" type="button" @click="convertToStock(item)">转为库存</button>
          <button class="delete" type="button" :aria-label="`删除 ${item.name}`" @click="remove(item)">
            删除
          </button>
        </li>
      </ul>
    </section>

    <section v-if="lowStockSuggestions.length > 0" class="low-stock-section" aria-label="低库存建议">
      <h2 class="section-title">
        低库存建议
        <span class="section-sub">在库数量低于最少库存，一键补货</span>
      </h2>
      <ul class="shopping-list">
        <li v-for="it in lowStockSuggestions" :key="`sug-${it.id}`" class="shopping-item suggestion">
          <span class="item-name">{{ it.name }}</span>
          <span class="item-meta">
            现存 {{ it.quantity }}{{ it.unit ? ` ${it.unit}` : '' }} · 最少 {{ it.minQuantity
            }}{{ it.unit ? ` ${it.unit}` : '' }}
          </span>
          <button class="convert" type="button" @click="addSuggestion(it)">
            加入清单（{{ suggestionQty(it) }}{{ it.unit ? ` ${it.unit}` : '' }}）
          </button>
        </li>
      </ul>
    </section>

    <section v-if="doneItems.length > 0" class="done-section">
      <div class="done-head">
        <button
          class="section-title section-toggle"
          type="button"
          :aria-expanded="!doneCollapsed"
          @click="doneCollapsed = !doneCollapsed"
        >
          已完成（{{ doneItems.length }}）<ChevronIcon :rotate="doneCollapsed ? 0 : 90" />
        </button>
        <!-- D-4：批量转入库存，免去逐件点击 -->
        <button class="convert convert-all" type="button" :disabled="batchConverting" @click="convertAllDone">
          {{ batchConverting ? '转库存中…' : '全部转为库存' }}
        </button>
      </div>
      <!-- 铁律 7 丝滑折叠：Grid 0fr→1fr 过渡，免 JS 算高 -->
      <div class="collapse" :class="{ open: !doneCollapsed }">
        <ul class="shopping-list">
        <li v-for="item in doneItems" :key="item.id" class="shopping-item done">
          <button class="toggle" type="button" :aria-label="`改回待购 ${item.name}`" @click="toggle(item)">
            ✓
          </button>
          <span class="item-name">{{ item.name }}</span>
          <span class="item-meta">
            <input
              class="qty-edit"
              type="number"
              min="1"
              step="1"
              :value="item.quantity"
              :aria-label="`修改数量 ${item.name}`"
              @change="updateQuantity(item, $event)"
            />
            <template v-if="item.unit">{{ item.unit }}</template>
          </span>
          <button class="convert" type="button" @click="convertToStock(item)">转为库存</button>
          <button class="delete" type="button" :aria-label="`删除 ${item.name}`" @click="remove(item)">
            删除
          </button>
        </li>
        </ul>
      </div>
    </section>

    <button
      v-if="convertedCount > 0"
      class="clear-converted"
      :class="{ confirming: confirmingClear }"
      type="button"
      @click="clearConverted"
    >
      {{ confirmingClear ? '确认清空已转换？' : '清空已转换' }}
    </button>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}
.pending-count {
  font-size: 13px;
  color: var(--color-muted);
}
.add-form {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 12px 14px;
  margin-bottom: 16px;
  display: grid;
  gap: 8px;
  grid-template-columns: 66px minmax(0, 1fr) 112px;
  grid-template-areas:
    'name name name'
    'qty unit price'
    'cat cat add';
}
.add-name {
  grid-area: name;
}
.add-quantity {
  grid-area: qty;
}
.add-unit {
  grid-area: unit;
}
.add-price {
  grid-area: price;
}
.add-category {
  grid-area: cat;
}
.add-submit {
  grid-area: add;
}
.add-name,
.add-quantity,
.add-unit,
.add-price,
.add-category {
  min-width: 0;
  border-radius: var(--radius-s);
  padding: 6px 8px;
  font: inherit;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-field); /* 与卡片 surface 分层（体检表 P0-2 连带修正：此前与卡片同色糊成一片） */
}
.add-submit {
  background: var(--color-ink);
  color: var(--color-on-ink);
  border-radius: var(--radius-s);
  padding: 8px 16px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
  transition: transform 120ms ease;
}
.add-submit:active {
  transform: scale(0.98);
}
@media (min-width: 1024px) {
  .add-form {
    grid-template-columns: minmax(200px, 1fr) 64px 88px 112px minmax(140px, 170px) auto;
    grid-template-areas: 'name qty unit price cat add';
    align-items: center;
  }
  .add-submit {
    padding-top: 7px;
    padding-bottom: 7px;
  }
}
.section-title {
  font-size: 15px;
  margin: 0 0 8px;
}
.pending-section,
.done-section {
  margin-bottom: 18px;
}
/* 用户反馈（2026-11-11）：已完成行紧贴低库存建议区，补上节间距 */
.done-section {
  margin-top: 18px;
}
.shopping-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.shopping-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-surface);
  border-radius: var(--radius-m);
  padding: 10px 12px;
}
.shopping-item.done .item-name {
  color: var(--color-muted);
  text-decoration: line-through;
}
.toggle {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--color-field);
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.shopping-item.done .toggle {
  background: var(--tone-green-bg);
  color: var(--tone-green-fg);
  border-color: transparent;
}
.item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: var(--fw-semibold);
  color: var(--color-text);
}
.item-meta {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--color-muted);
}
.qty-edit {
  width: 54px;
  border-radius: 4px; /* 迷你柱 */;
  padding: 2px 4px;
  font: inherit;
  font-size: 13px;
  color: var(--color-text);
  text-align: right;
}
.convert,
.delete {
  flex: none;
  background: var(--color-field);
  border-radius: var(--radius-s);
  padding: 4px 9px;
  font-size: 12px;
  color: var(--color-muted);
  cursor: pointer;
}
.convert {
  background: var(--tone-blue-bg);
  color: var(--tone-blue-fg);
  border-color: transparent;
}
.delete {
  color: var(--tone-red-fg);
}
.clear-converted {
  width: 100%;
  background: var(--color-field);
  border-radius: var(--radius-m);
  padding: 11px;
  font-size: 14px;
  color: var(--color-muted);
  cursor: pointer;
}
.clear-converted.confirming {
  color: var(--tone-red-fg);
  border-color: var(--tone-red-bg);
  background: var(--tone-red-bg);
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}
.empty-state {
  color: var(--color-muted);
  font-size: 14px;
  padding: 28px 0;
  text-align: center;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
  padding: 8px 0;
}
.notice-text {
  color: var(--tone-green-fg);
  font-size: 14px;
  padding: 8px 0;
}
</style>
<style scoped>
/* PC 充实化补充样式（追加，避免与既有规则纠缠） */
.pending-count b {
  color: var(--color-ink);
  font-weight: var(--fw-semibold);
}
.section-toggle {
  font: inherit;
  font-family: Georgia, 'Songti SC', 'Noto Serif SC', serif;
  font-weight: var(--fw-semibold);
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--color-ink);
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.section-sub {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
}
.shopping-item.suggestion {
  background: var(--color-row-expiring);
  border-color: var(--tone-yellow-bg);
}
.shopping-item.suggestion .item-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 2026-11-12 移动端审查 M-3：窄屏建议行改两行网格（名称+按钮 / 说明全宽），
   原单行 flex 下名称与说明被按钮挤到截断 */
@media (max-width: 767px) {
  .shopping-item.suggestion {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'name convert'
      'meta convert';
    row-gap: 2px;
    align-items: center;
  }
  .shopping-item.suggestion .item-name {
    grid-area: name;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .shopping-item.suggestion .item-meta {
    grid-area: meta;
    white-space: normal;
  }
  .shopping-item.suggestion .convert {
    grid-area: convert;
    align-self: center;
  }
}
</style>
<style scoped>
/* 铁律 7 丝滑折叠：Grid 0fr→1fr，免 JS 算高 */
.collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 260ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
.collapse > .shopping-list {
  overflow: hidden;
  min-height: 0;
}
.collapse.open {
  grid-template-rows: 1fr;
}

/* 铁律 9 欠阻尼微弹（spring 380/18 近似）：勾选完成时对勾轻微回弹，已读不弹 */
.shopping-item.done .toggle {
  animation: toggle-pop 380ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes toggle-pop {
  0% {
    transform: scale(0.7);
  }
  55% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shopping-item.done .toggle {
    animation: none;
  }
}
</style>
<style scoped>
/* 批量转库存完成提示 */
.notice-text {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.done-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.convert-all {
  flex: none;
  background: var(--tone-blue-bg);
  color: var(--tone-blue-fg);
  border: none;
  border-radius: var(--radius-m);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.convert-all:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
