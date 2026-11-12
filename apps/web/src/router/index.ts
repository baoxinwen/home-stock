import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import InventoryView from '../views/InventoryView.vue';
import { createAuthGuard } from './guard';
import { dynamicImportFailureReload } from './import-failure-recovery';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
    // vue-router@4.6.4 行为（2026-11-08 复现，clean-room 确认）：存在「无 meta 的 path:'/' 路由」时，
    // matcher 会污染其他路由的 meta（to.meta 变 {}，守卫的 meta.public 判定失效 → /login 无限重定向）。
    // 给 '/' 显式 meta 规避；升级 vue-router（5.x 已发布）后此行可精简。
    // 仪表盘方向（2026-11-08）：'/' = 总览工作台，库存列表独立成页 /inventory。
    { path: '/', name: 'overview', component: OverviewView, meta: {} },
    { path: '/inventory', name: 'inventory', component: InventoryView, meta: {} },
    { path: '/items/new', name: 'item-new', component: () => import('../views/ItemFormView.vue') },
    { path: '/items/:id', name: 'item-detail', component: () => import('../views/ItemDetailView.vue') },
    { path: '/items/:id/edit', name: 'item-edit', component: () => import('../views/ItemFormView.vue') },
    { path: '/archive', name: 'archive', component: () => import('../views/ArchiveView.vue') },
    { path: '/notifications', name: 'notifications', component: () => import('../views/NotifCenterView.vue') },
    { path: '/list', name: 'shopping', component: () => import('../views/ShoppingView.vue') },
    { path: '/stats', name: 'stats', component: () => import('../views/StatsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(createAuthGuard());

// 动态导入失败（vite dev 重启/PWA 换 hash/旧缓存）→ 整页自愈 reload 一次；sessionStorage 防循环（I-8）
export function recoverFromChunkLoadError(err: unknown): void {
  if (err instanceof Error) {
    dynamicImportFailureReload(err, sessionStorage, window.location);
  }
}

router.onError((err) => recoverFromChunkLoadError(err));
