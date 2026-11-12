/**
 * 主导航渲染门控（App.vue 用）。
 *
 * route.name === undefined 表示 vue-router 初始导航尚未完成（START_LOCATION）。
 * 此窗口内不能渲染主导航：AppSidebar 挂载即发 API 请求，无登录态时 401 →
 * api 层整页跳 /login → 打断初始导航 → 重载后再挂载 → 无限刷新循环
 * （2026-11-08 线上复现，修复回归见 App.spec 与 navigation-gate.spec）。
 */
export function shouldShowNav(
  routeName: string | symbol | undefined,
  loginName = 'login',
): boolean {
  return routeName != null && routeName !== loginName;
}
