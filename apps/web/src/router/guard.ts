import type { RouteLocationNormalized } from 'vue-router';
import { getStoredToken } from '../auth/token';

export type AuthGuardResult = { path: string; query: Record<string, string> };

/** 公开（免登录）路由：/login 是唯一入口页 */
const PUBLIC_PATH = '/login';

/**
 * 路由守卫：未登录访问业务页 → /login，并带 redirect 以便登录后回到原页面。
 *
 * 公开页判定以 **path 为主**、meta.public 为辅（双保险）：
 * vue-router@4.6.4 存在 record meta 被污染的问题（2026-11-08 clean-room 复现：
 * 存在无 meta 的 path:'/' 路由时，其他路由 to.meta 归一化为 {}，
 * meta.public 判定失效 → /login 无限重定向 → 初始导航失败/页面循环刷新）。
 * path 判据不依赖 meta，任何构建产物下行为一致。
 */
export function createAuthGuard(
  getToken: () => string | null = getStoredToken,
): (to: Pick<RouteLocationNormalized, 'path' | 'meta' | 'fullPath'>) => true | AuthGuardResult {
  return (to) => {
    if (to.path === PUBLIC_PATH || to.meta.public === true) return true;
    if (getToken()) return true;
    const query: Record<string, string> =
      to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {};
    return { path: PUBLIC_PATH, query };
  };
}
