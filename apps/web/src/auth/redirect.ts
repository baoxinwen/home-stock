/**
 * 登录跳转地址（M9.2 / Fix Round 1 Minor）：
 * 401 时跳登录页要保留当前位置（path + query），登录成功后能回到原页面。
 * - 根路径、空路径、已经在登录页 → 不带 redirect（避免自嵌套/无意义回跳）
 * - 其余一律 `encodeURIComponent` 整个目标地址，防止 query 里的 & 被吃掉
 */
export function loginRedirectUrl(pathname: string, search = ''): string {
  const path = (pathname ?? '').trim();
  const query = (search ?? '').trim();

  if (!path || path === '/' || /^\/login\/?$/i.test(path)) return '/login';

  return `/login?redirect=${encodeURIComponent(`${path}${query}`)}`;
}
