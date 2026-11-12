<script setup lang="ts">
/**
 * 临期提醒列表（统计页与总览仪表盘共用）。
 * entries 由父层用 lib/stats 的 expiringWithin 算好传入（已按剩余天数升序）。
 */
import { RouterLink } from 'vue-router';
import { badgeFor } from '../lib/badges';
import type { ExpiringEntry } from '../lib/stats';

const props = defineProps<{
  entries: ExpiringEntry[];
  /** 提示窗口天数（空态文案用） */
  windowDays: number;
  /** 空态下方是否显示「查看全部通知」链接 */
  showAllLink?: boolean;
}>();

function daysText(daysLeft: number): string {
  return daysLeft === 0 ? '今天到期' : `剩 ${daysLeft} 天`;
}
</script>

<template>
  <p v-if="entries.length === 0" class="panel-empty">
    未来 {{ windowDays }} 天没有到期物品
  </p>
  <template v-else>
    <ul class="expiring-list">
      <li v-for="e in entries" :key="e.item.id" class="expiring-row">
        <span class="expiring-name">{{ e.item.name }}</span>
        <span class="expiring-meta">
          {{ e.item.quantity }}{{ e.item.unit ? ` ${e.item.unit}` : '' }}
          <template v-if="e.item.opened"> · 已开封</template>
        </span>
        <span class="badge" :class="`tone-${badgeFor(e.item.expiryStatus, e.item.opened).tone}`">
          {{ daysText(e.daysLeft) }}
        </span>
      </li>
    </ul>
    <div v-if="showAllLink" class="expiring-more">
      <RouterLink to="/notifications">查看全部通知 →</RouterLink>
    </div>
  </template>
</template>

<style scoped>
.panel-empty {
  font-size: 13px;
  color: var(--color-muted);
  padding: 14px 0 6px;
  margin: 0;
}
.expiring-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.expiring-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-line);
  font-size: 13px;
}
.expiring-row:last-child {
  border-bottom: none;
}
.expiring-name {
  font-weight: var(--fw-semibold);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expiring-meta {
  color: var(--color-muted);
  font-size: 12px;
  flex: 1;
  min-width: 0;
}
.badge {
  flex: none;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
}
.badge.tone-yellow { background: var(--tone-yellow-bg); color: var(--tone-yellow-fg); }
.badge.tone-red { background: var(--tone-red-bg); color: var(--tone-red-fg); }
.badge.tone-green { background: var(--tone-green-bg); color: var(--tone-green-fg); }
.badge.tone-blue { background: var(--tone-blue-bg); color: var(--tone-blue-fg); }
.expiring-more {
  margin-top: 10px;
  text-align: right;
}
.expiring-more a {
  font-size: 12px;
  color: var(--color-muted);
  text-decoration: none;
}
</style>
