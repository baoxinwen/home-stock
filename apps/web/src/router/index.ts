import { nextTick } from 'vue';
import { createRouter, createWebHistory, type RouteMeta } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import InventoryView from '../views/InventoryView.vue';
import { createAuthGuard } from './guard';
import { dynamicImportFailureReload } from './import-failure-recovery';

const SITE_TITLE = '家庭库存助手';

/** afterEach 用：有页名拼「页名 · 站名」，无则回退站名（评审 A-H3 / WCAG 2.4.2） */
export function documentTitleFor(meta: RouteMeta): string {
  const title = typeof meta.title === 'string' ? meta.title : '';
  return title ? `${title} · ${SITE_TITLE}` : SITE_TITLE;
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true, title: '登录' } },
    // vue-router@4.6.4 行为（2026-11-08 复现，clean-room 确认）：存在「无 meta 的 path:'/' 路由」时，
    // matcher 会污染其他路由的 meta（to.meta 变 {}，守卫的 meta.public 判定失效 → /login 无限重定向）。
    // 给 '/' 显式 meta 规避；升级 vue-router（5.x 已发布）后此行可精简。
    // 仪表盘方向（2026-11-08）：'/' = 总览工作台，库存列表独立成页 /inventory。
    { path: '/', name: 'overview', component: OverviewView, meta: { title: '总览' } },
    { path: '/inventory', name: 'inventory', component: InventoryView, meta: { title: '库存' } },
    { path: '/items/new', name: 'item-new', component: () => import('../views/ItemFormView.vue'), meta: { title: '记一笔' } },
    { path: '/items/:id', name: 'item-detail', component: () => import('../views/ItemDetailView.vue'), meta: { title: '物品详情' } },
    { path: '/items/:id/edit', name: 'item-edit', component: () => import('../views/ItemFormView.vue'), meta: { title: '编辑物品' } },
    { path: '/archive', name: 'archive', component: () => import('../views/ArchiveView.vue'), meta: { title: '归档记录' } },
    { path: '/notifications', name: 'notifications', component: () => import('../views/NotifCenterView.vue'), meta: { title: '通知' } },
    { path: '/list', name: 'shopping', component: () => import('../views/ShoppingView.vue'), meta: { title: '购物清单' } },
    { path: '/stats', name: 'stats', component: () => import('../views/StatsView.vue'), meta: { title: '统计' } },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(createAuthGuard());

// 评审 A-H3：SPA 路由切换更新标题并把焦点移到内容容器（main[tabindex=-1]，App.vue 两分支各一），
// SR/浏览器标签页/历史才能区分页面——此前全站共用一个标题且焦点滞留旧位置
router.afterEach((to) => {
  document.title = documentTitleFor(to.meta);
  void nextTick(() => (document.querySelector('main') as HTMLElement | null)?.focus());
});

// 动态导入失败（vite dev 重启/PWA 换 hash/旧缓存）→ 整页自愈 reload 一次；sessionStorage 防循环（I-8）
export function recoverFromChunkLoadError(err: unknown): void {
  if (err instanceof Error) {
    dynamicImportFailureReload(err, sessionStorage, window.location);
  }
}

router.onError((err) => recoverFromChunkLoadError(err));
