<script setup lang="ts">
/**
 * 通知中心内容（共享）：收件箱三态（对标 GitHub inbox unread→read→done）。
 * - chips：收件箱（未完成）/ 未读 / 已完成；行内操作「完成 ✓」「已用完」「恢复」
 * - 点行打开物品即自动标已读（A3，fire-and-forget）；全部完成（B3）；相对时间（B1）
 * - 物品点击通过 open-item 事件上抛——页面壳桌面开抽屉/移动跳页，抽屉叠开物品抽屉
 * - 发送日志折叠（铁律 7 Grid）
 */
import { computed, onMounted, ref, watch } from 'vue';
import type { NotificationDto } from '@home-stock/shared';
import { api } from '../api';
import { relativeDate, todayISO } from '../lib/dates';

type InboxFilter = 'inbox' | 'unread' | 'done';

const emit = defineEmits<{
  'open-item': [itemId: number];
  /** read/done 变化（含行内操作），宿主刷新导航徽章 */
  'read-changed': [];
  /** 未读数变化（含首次加载），宿主页头展示用 */
  'unread-changed': [count: number];
}>();

const notifications = ref<NotificationDto[]>([]);
const logs = ref<{ id: number; channel: string | null; level?: string | null; message: string | null; createdAt: string | null }[]>([]);
const nameById = ref(new Map<number, string>());
const loading = ref(true);
const error = ref('');
const filter = ref<InboxFilter>('inbox');
const logsOpen = ref(false);
const completing = ref(false);

const today = todayISO();
const unread = computed(() => notifications.value.filter((n) => !n.read).length);

/** 未读数上抛（宿主页头展示）；immediate 使挂载即同步，无闪烁 */
watch(
  unread,
  (n) => {
    emit('unread-changed', n);
  },
  { immediate: true },
);
const inbox = computed(() => notifications.value.filter((n) => !n.done));
const doneList = computed(() => notifications.value.filter((n) => !!n.done));

const filtered = computed(() => {
  if (filter.value === 'unread') return inbox.value.filter((n) => !n.read);
  if (filter.value === 'done') return doneList.value;
  return inbox.value;
});

/** 收件箱/未读视图按 今天/更早 分组；已完成视图平铺（单组） */
const groups = computed(() => {
  if (filter.value === 'done') {
    return doneList.value.length ? [{ key: 'done', label: '已完成', items: doneList.value }] : [];
  }
  const todays = filtered.value.filter((n) => (n.sentDate ?? '') === today);
  const earlier = filtered.value.filter((n) => (n.sentDate ?? '') !== today);
  return [
    { key: 'today', label: '今天', items: todays },
    { key: 'earlier', label: '更早', items: earlier },
  ].filter((g) => g.items.length > 0);
});

/** 标题按类型取名；type 为 null（历史/异常数据）用中性文案，不误标临期（M14 移植） */
function titleOf(n: NotificationDto): string {
  if (n.type === null) return '提醒';
  return n.type === 'expired' ? '已过期提醒' : '临期提醒';
}

function typeToneOf(n: NotificationDto): string {
  return n.type === 'expired' ? 'red' : 'yellow';
}

/** 物品名：优先用发送时快照的 itemName（I-6），回退列表 join */
function nameOf(n: NotificationDto): string {
  if (n.itemName) return n.itemName;
  if (n.itemId == null) return '—';
  return nameById.value.get(n.itemId) ?? '（物品已删除）';
}

/** itemId 为空或物品已不存在（在库）时不可跳转 */
function canOpen(n: NotificationDto): boolean {
  return n.itemId != null && nameById.value.has(n.itemId);
}

/** R1 头像：色调随紧急度（expired 红 / 临期 黄 / 其余灰）；已完成或物品已删统一灰 */
function avaClass(n: NotificationDto): string {
  if (n.done || !canOpen(n)) return 'ava-gray';
  if (n.type === 'expired') return 'ava-red';
  if (n.type === 'expiring_soon') return 'ava-yellow';
  return 'ava-gray';
}

/** 头像文本：物品名首字；已删「?」、无物品「—」（不出现「（」） */
function avaText(n: NotificationDto): string {
  if (n.itemId == null) return '—';
  const name = n.itemName ?? nameById.value.get(n.itemId);
  return name ? name.trim().slice(0, 1) : '?';
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [list, active, archived, logList] = await Promise.all([
      api.listNotifications(),
      api.listItems(),
      api.listItems({ status: 'archived' }),
      api.listNotificationLogs(),
    ]);
    notifications.value = list;
    logs.value = logList;
    const map = new Map<number, string>();
    for (const it of [...active, ...archived]) map.set(it.id, it.name);
    nameById.value = map;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载通知失败';
  } finally {
    loading.value = false;
  }
}

/** A3 点行即已读（fire-and-forget，失败静默——badge 语义不被阻塞） */
function markReadQuietly(n: NotificationDto): void {
  if (n.read) return;
  n.read = 1;
  api
    .markNotificationsRead([n.id])
    .then(() => {
      emit('read-changed');
    })
    .catch(() => {});
}

/** 行点击：已读（A3）+ 上抛打开物品 */
function openItem(n: NotificationDto): void {
  if (!canOpen(n)) return;
  markReadQuietly(n);
  emit('open-item', n.itemId as number);
}

/** 完成 ✓：done=1（server 同时置已读）→ 移出收件箱 */
async function complete(n: NotificationDto): Promise<void> {
  try {
    await api.markNotificationsDone([n.id]);
    n.done = 1;
    n.read = 1;
    emit('read-changed');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  }
}

/** 已完成 → 恢复到收件箱（仅清 done） */
async function restore(n: NotificationDto): Promise<void> {
  try {
    await api.undoNotificationsDone([n.id]);
    n.done = 0;
    emit('read-changed');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  }
}

/** C1/I-6 行内快捷归档：按通知类型分流到正确去向（与详情页二选一口径一致）——
 *  临期 → used_up（正常消耗）；过期 → expired_discarded（计浪费）。
 *  归档可从归档页恢复；完成后通知移出收件箱 */
const quickArchiveBusy = ref(false);

async function quickArchive(n: NotificationDto): Promise<void> {
  if (!canOpen(n) || quickArchiveBusy.value) return;
  quickArchiveBusy.value = true;
  try {
    const reason = n.type === 'expired' ? 'expired_discarded' : 'used_up';
    await api.archiveItem(n.itemId as number, { reason });
    await api.markNotificationsDone([n.id]);
    n.done = 1;
    n.read = 1;
    nameById.value.delete(n.itemId as number);
    emit('read-changed');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    quickArchiveBusy.value = false;
  }
}

/** B3 全部完成：done 端点不带 ids = 全部（含已完成列表之外的全部收件箱项） */
async function completeAll(): Promise<void> {
  completing.value = true;
  try {
    await api.markNotificationsDone();
    notifications.value = notifications.value.map((n) => ({ ...n, done: 1, read: 1 }));
    emit('read-changed');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    completing.value = false;
  }
}

function setFilter(f: InboxFilter): void {
  filter.value = f;
}

function channelLabel(channel: string | null): string {
  if (channel === 'email') return '邮件';
  if (channel === 'wecom') return '企业微信';
  if (channel === 'inapp') return '应用内';
  return channel ?? '未知';
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="notif-center">
    <div class="toolbar">
      <div class="chips" role="group" aria-label="通知视图">
        <button class="chip" :class="{ active: filter === 'inbox' }" type="button" @click="setFilter('inbox')">
          收件箱 {{ inbox.length }}
        </button>
        <button class="chip" :class="{ active: filter === 'unread' }" type="button" @click="setFilter('unread')">
          未读 {{ unread }}
        </button>
        <button class="chip" :class="{ active: filter === 'done' }" type="button" @click="setFilter('done')">
          已完成 {{ doneList.length }}
        </button>
      </div>
      <div class="toolbar-right">
        <!-- 2026-11-11 审查 T-1：全部完成降级为工具行轻 pill（原列表下方大实底按钮与页面级 CTA 同权重） -->
        <button
          v-if="filter === 'inbox' && inbox.length > 0"
          class="mark-all"
          type="button"
          :disabled="completing"
          @click="completeAll"
        >
          全部完成
        </button>
        <button class="btn-ghost" type="button" :aria-expanded="logsOpen" @click="logsOpen = !logsOpen">
          发送日志 {{ logsOpen ? '▾' : '▸' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="loading && notifications.length === 0" class="muted-text">加载中…</p>
    <!-- B2 空态卡片化：无通知 vs 收件箱清空，主副文案两档 -->
    <div v-else-if="notifications.length === 0" class="empty-card">
      <div class="empty-icon" aria-hidden="true">🧺</div>
      <p class="empty-title">还没有提醒</p>
      <p class="empty-sub">添加物品后，临期和过期提醒会出现在这里</p>
    </div>
    <div v-else-if="groups.length === 0 && filter !== 'done'" class="empty-card">
      <div class="empty-icon" aria-hidden="true">🎉</div>
      <p class="empty-title">已全部处理</p>
      <p class="empty-sub">收件箱已清空，新提醒会出现在这里</p>
    </div>
    <p v-else-if="groups.length === 0" class="muted-text">没有已完成的记录。</p>

    <section
      v-for="g in groups"
      :key="g.key"
      class="notif-group"
      :aria-label="`${g.label}的通知`"
    >
      <h2 class="group-title">{{ g.label }}</h2>
      <ul class="notif-list">
        <li
          v-for="n in g.items"
          :key="n.id"
          class="notification-item"
          :class="{ unread: !n.read && !n.done, expired: n.type === 'expired', done: !!n.done }"
        >
          <button
            class="notif-main"
            type="button"
            :disabled="!canOpen(n) || !!n.done"
            :aria-label="`${titleOf(n)}：${nameOf(n)}${n.done ? '（已完成）' : ''}`"
            @click="openItem(n)"
          >
            <!-- R1 首字头像块：与库存列表同语言；已完成/无类型灰化，已删显 ? -->
            <span class="notif-ava" :class="avaClass(n)" aria-hidden="true">{{ avaText(n) }}</span>
            <span class="notif-body">
              <span class="notif-line1">
                <span class="notif-dot" :class="{ 'dot-unread': !n.read }" aria-hidden="true" />
                <span class="badge notif-title" :class="n.done ? 'tone-gray' : `tone-${typeToneOf(n)}`">{{ titleOf(n) }}</span>
                <span class="notif-name">{{ nameOf(n) }}</span>
              </span>
              <span class="notif-date num" :title="n.sentDate ?? ''">{{ relativeDate(n.sentDate, today) }}</span>
            </span>
          </button>
          <template v-if="!n.done">
            <button
              class="notif-action"
              type="button"
              :disabled="!canOpen(n) || quickArchiveBusy"
              :title="n.type === 'expired'
                ? '按过期丢弃归档（计入浪费统计），并完成这条通知'
                : '归档物品（可从归档页恢复）并完成这条通知'"
              @click="quickArchive(n)"
            >
              {{ n.type === 'expired' ? '已过期丢弃' : '已用完' }}
            </button>
            <!-- R2 主操作 ink 实色 pill -->
            <button class="notif-action primary" type="button" @click="complete(n)">完成 ✓</button>
          </template>
          <button v-else class="notif-action" type="button" @click="restore(n)">恢复</button>
        </li>
      </ul>
    </section>

    <!-- 铁律 7 丝滑折叠：Grid 0fr→1fr 过渡，免 JS 算高。
         内层 .logs-collapse-inner 负责裁剪：折叠元素的 padding 不能放在被裁剪元素自身 -->
    <section class="logs-collapse" :class="{ open: logsOpen }" aria-label="发送日志">
      <div class="logs-collapse-inner">
        <div class="logs-panel">
          <h2 class="group-title">发送日志</h2>
          <p v-if="logs.length === 0" class="muted-text">暂无发送记录</p>
          <ul v-else class="logs-list">
            <li v-for="log in logs" :key="log.id" class="log-row">
              <span class="badge" :class="log.level === 'error' ? 'tone-red' : 'tone-gray'">
                {{ channelLabel(log.channel) }}
              </span>
              <span class="log-message">{{ log.message }}</span>
              <span class="log-time num">{{ log.createdAt?.replace('T', ' ').slice(0, 16) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
.btn-ghost {
  background: var(--color-field);
  border-radius: var(--radius-m);
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}
.notif-group {
  margin-bottom: 14px;
}
.group-title {
  font-size: 13px;
  color: var(--color-muted);
  font-weight: var(--fw-semibold);
  margin: 0 0 8px;
}
.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.notification-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-surface);
  border-radius: var(--radius-m);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--color-muted);
}
.notification-item.unread {
  color: var(--color-text);
}
.notification-item.done {
  opacity: 0.6;
}
.notif-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.notif-main:disabled {
  cursor: default;
}
/* R1 首字头像块（与库存列表同语言） */
.notif-ava {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: var(--fw-semibold);
}
.ava-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.ava-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.ava-gray { background: var(--color-track); color: var(--color-muted); }
.notification-item.done .notif-ava {
  background: var(--color-field);
}
.notif-body {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.notif-line1 {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
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
  border-color: var(--tone-red-fg);
}
/* R3 已完成行去警示色（名称/badge 恢复中性），行透明度弱化 */
.notification-item.expired:not(.done) .notif-name {
  color: var(--tone-red-fg);
}
.notification-item.done .notif-name {
  color: var(--color-text);
}
.notif-name {
  font-weight: var(--fw-semibold);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-date {
  flex: none;
  font-size: 12px;
}
.notif-action {
  flex: none;
  background: none;
  border-radius: var(--radius-s);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--color-muted);
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
}
.notif-action:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-field);
}
.notif-action:disabled {
  opacity: 0.4;
  cursor: default;
}
/* R2 主操作：ink 实色 pill */
.notif-action.primary {
  background: var(--color-ink);
  color: var(--color-on-ink);
}
.notif-action.primary:hover:not(:disabled) {
  background: var(--color-ink-hover);
  color: var(--color-on-ink);
}
.badge {
  flex: none;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.badge.tone-gray { background: var(--color-track); color: var(--color-muted); }
/* 2026-11-11 审查 T-1：全部完成降级为工具行轻 pill（原 160px ink 实底与页面 CTA 同权重） */
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mark-all {
  height: var(--control-h);
  display: inline-flex;
  align-items: center;
  background: var(--color-field);
  color: var(--color-text);
  border-radius: var(--radius-s);
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 150ms ease-out, transform 120ms ease;
}
.mark-all:hover:not(:disabled) {
  background: var(--color-hover);
}
.mark-all:active:not(:disabled) {
  transform: scale(0.98);
}
.mark-all:disabled {
  opacity: 0.6;
  cursor: default;
}
/* 空态卡片：surface 卡 + 图标 + 主副文案 */
.empty-card {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 44px 24px;
  display: grid;
  place-items: center;
  gap: 6px;
  text-align: center;
}
.empty-icon {
  font-size: 40px;
  line-height: 1;
}
.empty-title {
  font-size: 15px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
  margin: 0;
}
.empty-sub {
  font-size: 13px;
  color: var(--color-muted);
  margin: 0;
}
.logs-collapse-inner .logs-panel {
  margin-top: 20px;
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: 14px 16px;
}
.logs-collapse-inner .logs-panel .group-title {
  margin-bottom: 10px;
}
.logs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.log-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--color-muted);
}
.log-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-time {
  flex: none;
}
.muted-text {
  color: var(--color-muted);
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}
.all-done {
  font-size: 15px;
}
.error-text {
  color: var(--tone-red-fg);
  font-size: 14px;
  padding: 12px 0;
}
</style>

<style scoped>
/* 铁律 7 丝滑折叠：Grid 0fr→1fr，免 JS 算高。
   裁剪层独立于带 padding 的面板：0fr 时面板整体（含 padding/圆角）被完全收起 */
.logs-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 260ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
.logs-collapse > .logs-collapse-inner {
  overflow: hidden;
  min-height: 0;
}
.logs-collapse.open {
  grid-template-rows: 1fr;
  margin-top: 20px;
}
</style>
