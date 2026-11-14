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

// 2026-11-12 移动端 IA（M-13 方案A，与 PC 对齐：通知是收件箱不是目的地）——
// tabbar 收 5 项去通知，通知入口收口到移动全局顶栏铃铛（红点未读数）
// 2026-11-13 设置同样移出一级导航（低频配置项）：tabbar 收 4 项，入口在顶栏齿轮
// 2026-11-13 细节轮 E3（M-9）：tabbar 图标化——icon+label 双行，大厂标准形态
const tabs = [
  {
    to: '/',
    label: '总览',
    paths: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  },
  {
    to: '/inventory',
    label: '库存',
    paths: ['M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M2 3h20v5H2z', 'M10 12h4'],
  },
  {
    to: '/list',
    label: '清单',
    badge: 'pending' as const,
    paths: [
      'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
      'M8 21h.01',
      'M19 21h.01',
    ],
  },
  {
    to: '/stats',
    label: '统计',
    paths: ['M12 20v-10', 'M18 20V4', 'M6 20v-4'],
  },
];

function badgeFor(tab: (typeof tabs)[number]): number | null {
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
    <!-- 移动全局顶栏：brand + 通知铃铛（红点未读，点击进通知全页） -->
    <header v-if="showNav" class="mobile-topbar">
      <span class="mobile-brand">家庭库存</span>
      <div class="mobile-tools">
        <RouterLink
          class="mobile-bell"
          to="/notifications"
          :aria-label="`通知（${unread} 条未读）`"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span v-if="unread > 0" class="mobile-bell-count num">{{ unread }}</span>
        </RouterLink>
        <!-- 设置齿轮（2026-11-13：与 PC 同构，全局工具区并排） -->
        <RouterLink class="mobile-gear" to="/settings" aria-label="设置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </RouterLink>
      </div>
    </header>
    <div class="app-shell">
      <RouterView />
    </div>
    <nav v-if="showNav" class="tabbar" aria-label="主导航">
      <div class="tabbar-inner">
        <RouterLink v-for="t in tabs" :key="t.to" class="tab-item" :to="t.to">
          <span class="tab-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-for="(d, i) in t.paths" :key="i" :d="d" />
            </svg>
            <span
              v-if="badgeFor(t) !== null && badgeFor(t)! > 0"
              class="tab-badge tab-badge-blue"
            >{{ badgeFor(t) }}</span>
          </span>
          <span class="tab-label">{{ t.label }}</span>
        </RouterLink>
      </div>
    </nav>
  </template>
</template>
