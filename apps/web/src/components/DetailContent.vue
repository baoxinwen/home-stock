<script setup lang="ts">
/**
 * 物品详情内容（共享）：详情卡 / 快捷操作 / 关联提醒 / 归档删除弹层。
 * 宿主：ItemDetailView（移动端与直链全页）与 ItemDrawer（桌面抽屉）。
 * 数据自包含：按 itemId 加载物品/类别/关联通知；变更通过 emit 通知宿主刷新。
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import type { ArchiveReason, CategoryDto, ItemDto, NotificationDto } from '@home-stock/shared';
import { archiveBadgeFor, badgeFor } from '../lib/badges';
import { formatDateCN, todayISO } from '../lib/dates';
import { api } from '../api';
import { overdueDays as sharedOverdueDays } from '@home-stock/shared';
import RestoreChoicePanel from './RestoreChoicePanel.vue';
import ItemAvatar from './ItemAvatar.vue';
import { useItemRestore } from '../composables/useItemRestore';
import { useItemDetail } from '../composables/useItemDetail';
import { imageUrl } from '../lib/images';

const props = defineProps<{ itemId: number }>();
const emit = defineEmits<{ deleted: []; changed: [] }>();

const router = useRouter();
const { item, loading, error, load, archive, restore, remove } = useItemDetail(props.itemId);

// id → 类别名映射（详情不渲染裸 ID）
const categories = ref<CategoryDto[]>([]);
void api
  .listCategories()
  .then((list) => (categories.value = list))
  .catch(() => {
    /* 映射失败时回退显示「未分类」 */
  });
const categoryName = computed(() => {
  if (item.value?.categoryId === null || item.value?.categoryId === undefined) return '未分类';
  return categories.value.find((c) => c.id === item.value?.categoryId)?.name ?? '未分类';
});

// 归档去向二选一（reason 选择弹层）
const archiveOpen = ref(false);
const confirmDelete = ref(false);
const actionError = ref('');

const statusBadge = computed(() =>
  item.value ? badgeFor(item.value.expiryStatus, item.value.opened) : null,
);
const archiveBadge = computed(() =>
  item.value ? archiveBadgeFor(item.value.archivedReason) : null,
);

const rows = computed(() => {
  const it = item.value;
  if (!it) return [];
  // 审查 D-1：「过期日期/有效过期日」两个近似字段费解——生效值恒显示为「过期日期」，
  // 仅当开封重算改变了生效值时才追加一行原始标注
  const recalculated =
    it.expiryDate !== null && it.effectiveExpiryDate !== it.expiryDate;
  return [
    { label: '类别', value: categoryName.value },
    { label: '数量', value: `${it.quantity}${it.unit ? ` ${it.unit}` : ''}` },
    { label: '购买日期', value: formatDateCN(it.purchaseDate) },
    { label: '价格', value: it.price === null ? '—' : `¥${it.price}` },
    { label: '过期日期', value: formatDateCN(it.effectiveExpiryDate) },
    ...(recalculated
      ? [{ label: '标注到期（开封前）', value: `${formatDateCN(it.expiryDate)} · 开封后重算` }]
      : []),
    { label: '开封', value: it.opened ? `已开封（${formatDateCN(it.openedAt)}）` : '未开封' },
    { label: '开封后保质', value: it.openShelfDays === null ? '—' : `${it.openShelfDays} 天` },
    { label: '提醒阈值', value: it.remindDays === null ? `默认 ${defaultRemindDays.value} 天` : `${it.remindDays} 天` },
    { label: '最少库存', value: it.minQuantity === null ? '—' : `${it.minQuantity}${it.unit ? ` ${it.unit}` : ''}` },
  ];
});

// ---------- 快捷操作：开封切换、数量步进 ----------
/** I-2：开封切换 in-flight 禁用（toggle 排队语义混乱，宁等一拍） */
const toggling = ref(false);

async function toggleOpen(): Promise<void> {
  if (!item.value || toggling.value) return;
  toggling.value = true;
  try {
    const updated = await api.updateItem(props.itemId, { opened: item.value.opened === 1 ? 0 : 1 });
    item.value = updated;
    emit('changed');
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '开封状态更新失败';
  } finally {
    toggling.value = false;
  }
}

/** I-2 根因修复：in-flight 期间按钮禁用（:disabled 同步关闭），丢失更新的
 *  窗口（await 挂起中可再点）被关闭——每次可点击时 item 已是服务器最新值，
 *  每次点击都精确生效一次，绝不静默丢失（连点中多出的点击无事件，无害） */
const stepBusy = ref(false);

async function stepQuantity(delta: number): Promise<void> {
  if (!item.value || stepBusy.value) return;
  const next = Math.round((item.value.quantity + delta) * 100) / 100;
  if (next < 0) return;
  stepBusy.value = true;
  actionError.value = '';
  try {
    const updated = await api.updateItem(props.itemId, { quantity: next });
    item.value = updated;
    emit('changed');
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '数量更新失败';
  } finally {
    stepBusy.value = false;
  }
}

// ---------- 关联通知时间线 ----------
const itemNotifs = ref<NotificationDto[]>([]);

function titleOf(n: NotificationDto): string {
  return n.type === 'expired' ? '已过期提醒' : '临期提醒';
}

/** 全局默认提醒阈值（D-13 移植：读真实设置，不再硬编码「默认 3」）；拉取失败回退 3 */
const defaultRemindDays = ref(3);

onMounted(async () => {
  try {
    const list = await api.listNotifications();
    itemNotifs.value = list
      .filter((n) => n.itemId === props.itemId)
      .sort((a, b) => (b.sentDate ?? '').localeCompare(a.sentDate ?? ''));
  } catch {
    /* 通知加载失败不阻塞详情 */
  }
  try {
    defaultRemindDays.value = (await api.getSettings()).default_remind_days;
  } catch {
    /* 设置拉取失败不阻塞详情 */
  }
});

async function doArchive(reason: ArchiveReason): Promise<void> {
  actionError.value = '';
  try {
    await archive(reason);
    archiveOpen.value = false;
    emit('changed');
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败';
  }
}

/** I-4：过期品恢复不再直通——记录待恢复物品，弹 D-9 同款去向面板 */
const restoreChoice = ref<ItemDto | null>(null);
const overdue = computed(() => sharedOverdueDays(restoreChoice.value?.effectiveExpiryDate ?? null, todayISO()));

function requestRestore(): void {
  actionError.value = '';
  const it = item.value;
  if (!it) return;
  if (sharedOverdueDays(it.effectiveExpiryDate, todayISO()) >= 1) {
    restoreChoice.value = it;
    return;
  }
  void doRestore();
}

// C-1/I-4：执行语义收敛到共享 composable（顺延含清开封 + 本地口径）
const { restoringId, postponeAndRestore, forceRestore } = useItemRestore({
  onDone: async () => {
    restoreChoice.value = null;
    await load();
    emit('changed');
  },
  onError: (message) => {
    actionError.value = message;
  },
});

async function doRestore(): Promise<void> {
  actionError.value = '';
  try {
    await restore();
    emit('changed');
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败';
  }
}

async function doDelete(): Promise<void> {
  actionError.value = '';
  try {
    await remove();
    emit('deleted');
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '操作失败';
  }
}

</script>

<template>
  <p v-if="error" class="error-text" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="muted-text">加载中…</p>

  <template v-else-if="item">
    <div class="detail-card">
      <div class="card-head">
        <!-- 图片（0006）：有图时头像位显示图片（点击新窗口看原图），无图保持首字母占位 -->
        <a
          v-if="item.imagePath"
          class="avatar avatar-photo"
          :href="imageUrl(item.imagePath)"
          target="_blank"
          rel="noopener"
          :aria-label="`查看 ${item.name} 的图片`"
        >
          <ItemAvatar :name="item.name" :image-path="item.imagePath" />
        </a>
        <ItemAvatar
          v-else
          :name="item.name"
          :tone="statusBadge?.tone"
        />
        <div class="head-info">
          <h2 class="item-name">{{ item.name }}</h2>
          <span v-if="item.status === 'active'" class="badge" :class="`tone-${statusBadge?.tone}`">
            {{ statusBadge?.text }}
          </span>
          <span v-else class="badge" :class="`tone-${archiveBadge?.tone}`">
            已归档 · {{ archiveBadge?.text }}
          </span>
        </div>
      </div>
      <dl class="rows">
        <div v-for="row in rows" :key="row.label" class="row">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
        <div v-if="item.archivedAt" class="row">
          <dt>归档日期</dt>
          <dd>{{ formatDateCN(item.archivedAt.slice(0, 10)) }}</dd>
        </div>
      </dl>
    </div>

    <!-- 快捷操作（仅在库品）：审查 D-3 拆两组——开封状态与数量步进各自成卡，语义不再混排 -->
    <section v-if="item.status === 'active'" class="quick-row" aria-label="快捷操作">
      <div class="quick-card">
        <h3 class="quick-label">开封状态</h3>
        <button
          class="open-toggle"
          :class="{ opened: item.opened === 1 }"
          type="button"
          @click="toggleOpen"
        >
          {{ item.opened === 1 ? '取消开封' : '开封' }}
        </button>
      </div>
      <div class="quick-card">
        <h3 class="quick-label">数量</h3>
        <div class="qty-stepper" aria-label="调整数量">
          <button class="step-btn" type="button" aria-label="减少数量" :disabled="stepBusy" @click="stepQuantity(-1)">−</button>
          <span class="qty-value num">{{ item.quantity }}{{ item.unit ? ` ${item.unit}` : '' }}</span>
          <button class="step-btn" type="button" aria-label="增加数量" :disabled="stepBusy" @click="stepQuantity(1)">＋</button>
        </div>
      </div>
    </section>

    <p v-if="actionError" class="error-text" role="alert">{{ actionError }}</p>

    <!-- 关联通知时间线 -->
    <section v-if="itemNotifs.length > 0" class="notif-card" aria-label="关联提醒">
      <h2 class="card-title">相关提醒（{{ itemNotifs.length }}）</h2>
      <ul class="notif-timeline">
        <li v-for="n in itemNotifs" :key="n.id" class="notif-row">
          <span class="badge" :class="n.type === 'expired' ? 'tone-red' : 'tone-yellow'">
            {{ titleOf(n) }}
          </span>
          <span class="notif-date num">{{ n.sentDate }}</span>
          <span class="notif-read">{{ n.read ? '已读' : '未读' }}</span>
        </li>
      </ul>
      <RouterLink class="notif-link" to="/notifications">前往通知中心 →</RouterLink>
    </section>

    <div class="actions" :class="{ 'is-archived': item.status !== 'active' }">
      <template v-if="item.status === 'active'">
        <button class="btn-primary" type="button" @click="router.push(`/items/${props.itemId}/edit`)">编辑</button>
        <button class="btn-secondary" type="button" @click="archiveOpen = true">归档</button>
      </template>
      <template v-else>
        <button class="btn-primary" type="button" @click="requestRestore">恢复</button>
      </template>
      <button class="btn-danger" type="button" @click="confirmDelete = true">删除</button>
    </div>

    <!-- 归档去向二选一 -->
    <div v-if="archiveOpen" class="mask" @click.self="archiveOpen = false">
      <div class="panel" role="dialog" aria-label="选择归档去向">
        <h2 class="panel-title">这个物品怎么处理的？</h2>
        <button class="option" type="button" @click="doArchive('used_up')">
          <span class="badge tone-green">用完</span>
          <span class="option-hint">正常消耗</span>
        </button>
        <button class="option" type="button" @click="doArchive('expired_discarded')">
          <span class="badge tone-red">过期丢弃</span>
          <span class="option-hint">过期后扔掉</span>
        </button>
        <button class="link-btn" type="button" @click="archiveOpen = false">取消</button>
      </div>
    </div>

    <!-- 删除二次确认 -->
    <div v-if="confirmDelete" class="mask" @click.self="confirmDelete = false">
      <div class="panel" role="dialog" aria-label="确认删除">
        <h2 class="panel-title">确认删除？</h2>
        <p class="confirm-text">误录入才删除，正常用完请归档。删除后不可恢复。</p>
        <div class="confirm-actions">
          <button class="btn-secondary" type="button" @click="confirmDelete = false">取消</button>
          <button class="btn-danger" type="button" @click="doDelete">仍要删除</button>
        </div>
      </div>
    </div>

    <!-- I-4：过期品恢复去向面板（与归档页 D-9 同语义，共享组件） -->
    <RestoreChoicePanel
      v-if="restoreChoice"
      :item="restoreChoice"
      :overdue-days="overdue"
      :restoring="restoringId !== null"
      @close="restoreChoice = null"
      @postpone="postponeAndRestore(restoreChoice.id)"
      @force="forceRestore(restoreChoice.id)"
    />
  </template>
</template>

<style scoped>
.detail-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 16px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 19px;
  font-weight: var(--fw-semibold);
}
.avatar.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.avatar.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.avatar.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.avatar.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }
/* 图片头像（0006）：同尺寸圆形裁剪；点击进原图（新窗口）；图片填充由 ItemAvatar 自带 */
.avatar-photo {
  padding: 0;
  overflow: hidden;
  flex: none;
}
.avatar-photo .avatar-img {
  width: 100%;
  height: 100%;
}
.head-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.item-name {
  font-size: 18px;
  font-weight: var(--fw-semibold);
  margin: 0;
}
.badge {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.badge.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.badge.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }
.rows {
  margin: 0;
  display: grid;
  gap: 0;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid var(--color-border);
}
.row:last-child {
  border-bottom: none;
}
.row dt {
  color: var(--color-muted);
  font-size: 14px;
}
.row dd {
  margin: 0;
  font-size: 14px;
  color: var(--color-text);
}
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}
.actions .btn-danger {
  grid-column: 1 / -1;
}
/* 归档态只有「恢复」一个主操作：与删除并排一行（活跃态删除仍独占整行做危险隔离） */
.actions.is-archived .btn-danger {
  grid-column: auto;
}
.btn-primary,
.btn-secondary,
.btn-danger {
  border-radius: var(--radius-s);
  padding: 12px 16px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform 120ms ease;
}
.btn-primary:active,
.btn-secondary:active,
.btn-danger:active {
  transform: scale(0.98);
}
.btn-primary {
  background: var(--color-ink);
  color: var(--color-on-ink);
}
.btn-secondary {
  background: var(--color-field);
  border-color: var(--color-border);
  color: var(--color-text);
}
.btn-danger {
  background: var(--tone-red-bg);
  color: var(--tone-red-fg);
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(17, 17, 17, 0.35);
  display: grid;
  place-items: center;
  padding: 16px;
  z-index: 30;
}
.panel {
  background: var(--color-canvas);
  border-radius: var(--radius-l);
  width: 100%;
  max-width: 360px;
  padding: 20px;
  display: grid;
  gap: 10px;
}
.panel-title {
  font-size: 16px;
  font-weight: var(--fw-semibold);
  margin: 0;
}
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-surface);
  border-radius: var(--radius-m);
  padding: 12px 14px;
  font: inherit;
  cursor: pointer;
  transition: transform 120ms ease;
}
.option:active {
  transform: scale(0.98);
}
.option-hint {
  font-size: 13px;
  color: var(--color-muted);
}
/* .link-btn 全局化（2026-11-13 细节轮 D-2，main.css 接管去下划线+hover） */
.confirm-text {
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.6;
  margin: 0;
}
.confirm-actions {
  display: flex;
  gap: 10px;
}
.confirm-actions > button {
  flex: 1;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
}

/* 快捷操作：两组并排卡（审查 D-3） */
.quick-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.quick-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 12px 14px;
  flex-wrap: wrap;
  min-width: 0;
}
.quick-label {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-semibold);
  margin: 0;
  white-space: nowrap;
}
.open-toggle {
  background: var(--color-field);
  border: none;
  border-radius: var(--radius-m);
  padding: 8px 16px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.open-toggle.opened {
  background: var(--tone-blue-bg);
  color: var(--tone-blue-fg);
  border-color: var(--tone-blue-bg);
}
.qty-stepper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.quick-card .qty-stepper {
  margin-left: auto;
}
.step-btn {
  width: 32px;
  height: 32px;
  background: var(--color-field);
  border: none;
  border-radius: var(--radius-m);
  font-size: 16px;
  color: var(--color-text);
  cursor: pointer;
}
.step-btn:active {
  transform: scale(0.96);
}
.qty-value {
  min-width: 64px;
  text-align: center;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}

/* 关联提醒时间线 */
.notif-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 12px 14px;
  margin-bottom: 12px;
}
.card-title {
  font-size: 14px;
  margin: 0 0 8px;
}
.notif-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.notif-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--color-muted);
}
.notif-date {
  font-size: 12px;
}
.notif-read {
  margin-left: auto;
  font-size: 12px;
}
.notif-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-muted);
  text-decoration: none;
}
</style>
