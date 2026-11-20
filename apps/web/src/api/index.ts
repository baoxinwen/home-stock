import { loginRedirectUrl } from '../auth/redirect';
import { clearStoredToken, getStoredToken } from '../auth/token';
import { createApiClient } from './api';

/** 快照接口路径（与 vite.config.ts 的 runtimeCaching urlPattern 同口径，pathname 判） */
const SNAPSHOT_PATH_RE = /\/api\/(items|categories|shopping-items)(\?|$)/;
/** 快照最近一次成功时间（OfflineBanner 展示「数据截至」用） */
export const SNAPSHOT_AT_KEY = 'home-stock.snapshot-at';

/**
 * 快照时间戳记录：快照接口 GET 成功即记 localStorage，应用层实现与 SW 缓存解耦（reno 思路）。
 * localStorage 不可用（隐私模式）时静默，只影响离线标识条的时间戳展示。
 */
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    if (res.ok && method === 'GET' && SNAPSHOT_PATH_RE.test(url)) {
      // 评审 I-8：以响应自带 Date 头为准——SW 缓存回落的 Response 保留原始生成时刻，
      // 离线命中不再把「数据截至」刷新成当下；网络直连时即服务器取数时刻。
      // 头缺失（异常代理等）回退本机时间
      const serverDate = Date.parse(res.headers.get('date') ?? '');
      localStorage.setItem(SNAPSHOT_AT_KEY, String(Number.isNaN(serverDate) ? Date.now() : serverDate));
    }
  } catch {
    /* 时间戳记录失败不影响请求本身 */
  }
  return res;
};

/**
 * 全局单例：baseUrl 走 vite proxy / 同源静态托管。
 * - 每次请求自动带 X-Access-Token
 * - 401 → 清空本地口令并跳登录页，保留当前位置（?redirect=）以便登录后回跳
 */
export const api = createApiClient({
  baseUrl: '/api',
  fetchImpl: recordingFetch,
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
