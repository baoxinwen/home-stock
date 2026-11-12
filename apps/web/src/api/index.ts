import { loginRedirectUrl } from '../auth/redirect';
import { clearStoredToken, getStoredToken } from '../auth/token';
import { createApiClient } from './api';

/**
 * 全局单例：baseUrl 走 vite proxy / 同源静态托管。
 * - 每次请求自动带 X-Access-Token
 * - 401 → 清空本地口令并跳登录页，保留当前位置（?redirect=）以便登录后回跳
 */
export const api = createApiClient({
  baseUrl: '/api',
  getToken: getStoredToken,
  onUnauthorized: () => {
    clearStoredToken();
    if (typeof window !== 'undefined') {
      // I-2：登录页自身的 401 属预期失败（口令错误），交给表单行内错误展示；
      // 此时 loginRedirectUrl 返回 '/login'，同址 assign = 整页 reload，错误提示永远丢失 → 短路。
      // 不改 loginRedirectUrl 本身（其他调用方语义不变）。
      if (/^\/login\/?$/i.test(window.location.pathname)) return;
      window.location.assign(loginRedirectUrl(window.location.pathname, window.location.search));
    }
  },
});
