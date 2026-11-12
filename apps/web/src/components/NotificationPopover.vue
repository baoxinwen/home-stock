<script setup lang="ts">
/**
 * 通知下拉面板（桌面端轻量入口，方案「轻量下拉」）：
 * 铃铛点击弹出，快速扫一眼收件箱（未完成）+ 全部完成；点行直接跳物品详情
 * （面板是 glance，点行 = 要处理这个物品，跳转时顺带标已读）；
 * 深度处理（筛选/分组/发送日志）经底部「查看全部通知」去全页。
 * 挂载即拉数据（轻量一次并行请求）；外部点击/Esc/路由变化关闭；未读变化刷新导航徽章单例。
 * 定位：absolute 挂在顶栏铃铛容器内（.topnav-bell-wrap），随铃铛右对齐。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { ItemDto, NotificationDto } from '@home-stock/shared';
import { api } from '../api';
import { refreshNavBadges } from '../composables/useNavBadges';
import { relativeDate, todayISO } from '../lib/dates';

const emit = defineEmits<{ close: [] }>();

const panelEl = ref<HTMLElement | null>(null);
const loading = ref(true);
const error = ref('');
const markingAll = ref(false);
const router = useRouter();
const route = useRoute();
const today = todayISO();

interface DisplayRow {
  id: number;
  type: NotificationDto['type'];
  read: number;
  itemId: number | null;
  name: string;
  meta: string;
  daysLeft: number | null;
  canOpen: boolean;
  sentDate: string | null;
}

const rows = ref<DisplayRow[]>([]);
/** 是否存在过任意通知（区分「全部处理完 🎉」与「从没有通知」两种空态） */
const hasAny = ref(false);

async function reload(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, items] = await Promise.all([api.listNotifications(), api.listItems()]);
    hasAny.value = list.length > 0;
    const byId = new Map<number, ItemDto>(items.map((it) => [it.id, it]));
    const today = todayISO();
    // 铃铛面板只显示收件箱（未完成）的最近 8 条；已完成的去全页「已完成」视图
    rows.value = list
      .filter((n) => !n.done)
      .slice(0, 8)
      .map((n) => {
      const it = n.itemId != null ? byId.get(n.itemId) : undefined;
      let daysLeft: number | null = null;
      if (it?.effectiveExpiryDate) {
        const left = Math.round(
          (Date.parse(`${it.effectiveExpiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
        );
        daysLeft = Number.isFinite(left) ? left : null;
      }
      return {
        id: n.id,
        type: n.type,
        read: n.read,
        itemId: n.itemId,
        name: n.itemName || (n.itemId != null ? (byId.get(n.itemId)?.name ?? '（物品已删除）') : '—'),
        meta: it ? `${it.quantity}${it.unit ? ` ${it.unit}` : ''}${it.opened ? ' · 已开封' : ''}` : '',
        daysLeft,
        canOpen: n.itemId != null && byId.has(n.itemId),
        sentDate: n.sentDate,
      };
      });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载通知失败';
  } finally {
    loading.value = false;
  }
}
void reload();

const unreadShown = computed(() => rows.value.filter((n) => !n.read).length);

/** 天数徽章：已过期红、其余黄（与全页 badgeFor 口径一致）。
    通知 type 是发送时快照，物品可能此后才过期——按实时天数修正展示 */
function daysBadge(n: DisplayRow): { text: string; tone: string } {
  if (n.daysLeft != null && n.daysLeft < 0) return { text: '已过期', tone: 'red' };
  if (n.type === 'expired') return { text: '已过期', tone: 'red' };
  if (n.daysLeft == null) return { text: '提醒', tone: 'yellow' };
  if (n.daysLeft === 0) return { text: '今天到期', tone: 'yellow' };
  return { text: `剩 ${n.daysLeft} 天`, tone: 'yellow' };
}

/** B3 全部完成：done 端点不带 ids = 全部；完成 ⊃ 已读，badge 归零 */
async function markAll(): Promise<void> {
  markingAll.value = true;
  try {
    await api.markNotificationsDone();
    rows.value = [];
    refreshNavBadges();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    markingAll.value = false;
  }
}

/** 行点击：直接跳物品详情，顺带标已读（A3，fire-and-forget）；路由变化 watcher 收起面板 */
function openItem(n: DisplayRow): void {
  if (!n.canOpen) return;
  if (!n.read) {
    n.read = 1;
    api
      .markNotificationsRead([n.id])
      .then(() => refreshNavBadges())
      .catch(() => {});
  }
  void router.push(`/items/${n.itemId}`);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}
function onDocClick(e: MouseEvent): void {
  if (panelEl.value && !panelEl.value.contains(e.target as Node)) emit('close');
}
document.addEventListener('keydown', onKeydown);
document.addEventListener('click', onDocClick);
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onDocClick);
});

// 路由变化（如「查看全部通知」跳转）时收起
watch(
  () => route.fullPath,
  () => emit('close'),
);
</script>

<template>
  <Transition name="pop">
    <div ref="panelEl" class="notif-pop" role="dialog" aria-label="通知面板">
      <div class="notif-pop-head">
        <span class="notif-pop-title">
          通知
          <span class="notif-pop-count num">未读 {{ unreadShown }}</span>
        </span>
        <button
          v-if="rows.length > 0"
          class="link-btn"
          type="button"
          :disabled="markingAll"
          @click="markAll"
        >
          全部完成
        </button>
      </div>

      <div class="notif-pop-list">
        <p v-if="error" class="pop-error" role="alert">{{ error }}</p>
        <p v-else-if="loading && rows.length === 0" class="pop-hint">加载中…</p>
        <p v-else-if="rows.length === 0" class="pop-hint">{{ hasAny ? '已全部处理 🎉' : '还没有提醒，保持得很好。' }}</p>
        <button
          v-for="n in rows"
          v-else
          :key="n.id"
          class="notif-pop-row"
          :class="{ unread: !n.read }"
          type="button"
          :disabled="!n.canOpen"
          :title="relativeDate(n.sentDate, today)"
          :aria-label="`${n.type === 'expired' ? '已过期提醒' : '临期提醒'}：${n.name}`"
          @click="openItem(n)"
        >
          <span class="notif-dot" :class="{ 'dot-unread': !n.read }" aria-hidden="true" />
          <span class="row-name">{{ n.name }}</span>
          <span v-if="n.meta" class="row-meta">{{ n.meta }}</span>
          <span class="badge" :class="`tone-${daysBadge(n).tone}`">{{ daysBadge(n).text }}</span>
        </button>
      </div>

      <div class="notif-pop-foot">
        <span class="foot-hint">筛选与发送日志在通知页</span>
        <RouterLink class="foot-link" to="/notifications">查看全部通知 →</RouterLink>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.notif-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: 400px;
  background: var(--color-surface);
  border-radius: var(--radius-l);
  box-shadow:
    0 0 0 1px var(--color-line),
    0 16px 40px rgba(0, 0, 0, 0.14);
  overflow: hidden;
}
.notif-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-line);
}
.notif-pop-title {
  font-family: Georgia, 'Songti SC', 'Noto Serif SC', serif;
  font-size: 15px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}
.notif-pop-count {
  font-size: 12px;
  color: var(--color-muted);
  font-weight: var(--fw-normal);
  margin-left: 4px;
}
.link-btn {
  font-size: 13px;
  color: var(--color-muted);
  border-radius: var(--radius-s);
  padding: 3px 8px;
  cursor: pointer;
}
.link-btn:hover {
  color: var(--color-text);
  background: var(--color-field);
}
.link-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.notif-pop-list {
  padding: 8px;
  display: grid;
  gap: 4px;
  max-height: 380px;
  overflow-y: auto;
}
.notif-pop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border-radius: var(--radius-m);
  font-size: 13px;
  color: var(--color-muted);
  transition: background 150ms ease-out;
}
.notif-pop-row:hover:not(:disabled) {
  background: var(--color-field);
}
.notif-pop-row:disabled {
  cursor: default;
}
.notif-pop-row.unread {
  color: var(--color-text);
}
.notif-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
}
.dot-unread {
  background: var(--tone-red-fg);
}
.row-name {
  font-weight: var(--fw-semibold);
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta {
  flex: none;
  font-size: 12px;
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
.pop-hint {
  font-size: 13px;
  color: var(--color-muted);
  padding: 18px 10px;
  text-align: center;
}
.pop-error {
  font-size: 13px;
  color: var(--tone-red-fg);
  padding: 12px 10px;
}
.notif-pop-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-line);
}
.foot-hint {
  font-size: 12px;
  color: var(--color-muted);
}
.foot-link {
  font-size: 13px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
  text-decoration: none;
}
.foot-link:hover {
  color: var(--color-ink-hover);
}
/* 弹出：opacity + translateY（铁律 9） */
.pop-enter-active {
  transition:
    opacity 180ms ease-out,
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.pop-leave-active {
  transition:
    opacity 140ms ease-in,
    transform 140ms ease-in;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active {
    transition: none;
  }
}
</style>
