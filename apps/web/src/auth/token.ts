/**
 * 访问口令的本地持久化（M9.2）：登录一次存 localStorage，请求自动带 X-Access-Token。
 * 只保存口令本身，不保存用户信息；退出登录/401 时清理。
 */
export const ACCESS_TOKEN_STORAGE_KEY = 'home-stock-access-token';

export function getStoredToken(): string | null {
  try {
    const value = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    // 隐私模式/禁用 localStorage 时按未登录处理
    return null;
  }
}

export function setStoredToken(token: string): void {
  const value = token.trim();
  if (!value) return;
  try {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, value);
  } catch {
    // 存不进去时本次会话仍可通过内存中的调用方继续；这里静默
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // 忽略
  }
}
