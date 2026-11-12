<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import AppTopNav from './components/AppTopNav.vue';
import { useMediaQuery } from './composables/useMediaQuery';
import { shouldShowNav } from './lib/navigation-gate';
import { useNavBadges } from './composables/useNavBadges';

const route = useRoute();
const isDesktop = useMediaQuery('(min-width: 1024px)');
// 初始导航未完成（name undefined）时不能渲染导航：导航徽章挂载即发 API，
// 无登录态时 401 → 整页跳 /login → 打断导航 → 重载 → 无限刷新循环（详见 lib/navigation-gate.ts）
const showNav = computed(() => shouldShowNav(route.name));
// D-10：移动端 tabbar 未读/待购徽章（铃铛与面板内未读变化经 useNavBadges 单例同步）
const { unread, pendingCount } = useNavBadges();

const tabs = [
  { to: '/', label: '总览' },
  { to: '/inventory', label: '库存' },
  { to: '/notifications', label: '通知', badge: 'unread' as const },
  { to: '/list', label: '清单', badge: 'pending' as const },
  { to: '/stats', label: '统计' },
  { to: '/settings', label: '设置' },
];

function badgeFor(tab: (typeof tabs)[number]): number | null {
  if (tab.badge === 'unread') return unread.value;
  if (tab.badge === 'pending') return pendingCount.value;
  return null;
}
</script>

<template>
  <!-- PC≥1024px：顶部导航 + 内容区；通知入口在顶栏铃铛（NotificationPopover，方案「轻量下拉」）。
       移动端保持单列 + 底部 tabbar，通知仍走全页 -->
  <div v-if="isDesktop && showNav" class="topnav-shell">
    <AppTopNav />
    <main class="topnav-main">
      <RouterView />
    </main>
  </div>
  <template v-else>
    <div class="app-shell">
      <RouterView />
    </div>
    <nav v-if="showNav" class="tabbar" aria-label="主导航">
      <div class="tabbar-inner">
        <RouterLink v-for="t in tabs" :key="t.to" class="tab-item" :to="t.to">
          {{ t.label }}
          <span
            v-if="badgeFor(t) !== null && badgeFor(t)! > 0"
            class="tab-badge"
            :class="t.badge === 'unread' ? 'tab-badge-red' : 'tab-badge-blue'"
          >{{ badgeFor(t) }}</span>
        </RouterLink>
      </div>
    </nav>
  </template>
</template>
