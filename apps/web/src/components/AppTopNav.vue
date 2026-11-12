<script setup lang="ts">
/**
 * 顶部导航（PC≥1024px 骨架，仪表盘方向）：
 * - 品牌 + 五项目的地导航（总览/库存/清单/统计/设置）
 * - 通知入口收敛为右上角铃铛（IA 调整：通知是覆盖层不是目的地，方案「轻量下拉」）
 * - 清单待购数徽章；右侧「记一笔」
 */
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import NotificationPopover from './NotificationPopover.vue';
import { useNavBadges } from '../composables/useNavBadges';

const router = useRouter();
// 徽章计数统一走 useNavBadges（挂载+路由切换刷新）
const { unread, pendingCount } = useNavBadges();
// 通知下拉面板开关（铃铛 @click.stop：避免立即触发面板的外部点击关闭）
const notifOpen = ref(false);

const nav = [
  { to: '/', label: '总览' },
  { to: '/inventory', label: '库存' },
  { to: '/list', label: '清单', badge: 'pending' as const },
  { to: '/stats', label: '统计' },
  { to: '/settings', label: '设置' },
] as const;
</script>

<template>
  <header class="topnav">
    <div class="topnav-inner">
      <span class="topnav-brand">家庭库存</span>
      <nav class="topnav-nav" aria-label="主导航">
        <RouterLink v-for="item in nav" :key="item.to" class="topnav-item" :to="item.to">
          {{ item.label }}
          <span
            v-if="'badge' in item && item.badge === 'pending' && pendingCount > 0"
            class="topnav-badge topnav-badge-blue"
          >{{ pendingCount }}</span>
        </RouterLink>
      </nav>
      <div class="topnav-right">
        <div class="topnav-bell-wrap">
          <button
            class="bell-btn"
            type="button"
            :aria-label="`通知（${unread} 条未读）`"
            :aria-expanded="notifOpen"
            @click.stop="notifOpen = !notifOpen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            <span v-if="unread > 0" class="bell-count num">{{ unread }}</span>
          </button>
          <NotificationPopover v-if="notifOpen" @close="notifOpen = false" />
        </div>
        <button class="topnav-add" type="button" @click="router.push('/items/new')">＋ 记一笔</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topnav {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 20;
}
.topnav-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 12px 32px;
  display: flex;
  align-items: center;
  gap: 28px;
}
.topnav-brand {
  font-family: Georgia, 'Songti SC', 'Noto Serif SC', serif;
  font-size: 18px;
  font-weight: var(--fw-semibold);
  color: var(--color-ink);
}
.topnav-nav {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.topnav-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-s);
  text-decoration: none;
  color: var(--color-muted);
  font-size: 14px;
  white-space: nowrap;
  transition: background 150ms ease-out;
  cursor: pointer;
}
.topnav-item:hover {
  background: var(--color-canvas);
}
.topnav-item.router-link-active {
  color: var(--color-ink);
  background: var(--color-canvas);
  font-weight: var(--fw-semibold);
}
.topnav-badge {
  font-size: 11px;
  line-height: 1;
  border-radius: var(--radius-pill);
  padding: 3px 7px;
}
.topnav-badge-blue {
  background: var(--tone-blue-bg);
  color: var(--tone-blue-fg);
}
.topnav-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.topnav-bell-wrap {
  position: relative;
}
/* 铃铛入口（通知 IA：覆盖层不占导航位） */
.bell-btn {
  position: relative;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-m);
  color: var(--color-muted);
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
}
.bell-btn:hover {
  background: var(--color-field);
  color: var(--color-ink);
}
.bell-btn:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 1.2px var(--color-ink),
    0 0 0 4.5px var(--ring-outer);
}
.bell-btn svg {
  width: 19px;
  height: 19px;
}
.bell-count {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: #c0392b;
  color: #fff;
  font-size: 10px;
  font-weight: var(--fw-semibold);
  line-height: 16px;
  text-align: center;
}
.topnav-add {
  background: var(--color-ink);
  color: var(--color-on-ink);
  border: none;
  border-radius: var(--radius-m);
  padding: 8px 14px;
  font-size: 14px;
  font-weight: var(--fw-semibold);
  cursor: pointer;
  flex: none;
}
</style>
