/**
 * I-8 RED — PWA 懒加载路由白屏兜底。
 * vite autoUpdate 换 hash 后，旧页面进入未访问路由时 import() 404 → 白屏。
 * 预期：router.onError 捕获 chunk 加载失败 → sessionStorage 防循环标记 +
 * window.location.reload()；同一次会话只自动刷一次；非 chunk 错误不刷。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredToken } from '../auth/token';
import { recoverFromChunkLoadError, router } from './index';

const CHUNK_ERR = () => new Error('Failed to fetch dynamically imported module: /assets/stats-abc123.js');

describe('router chunk 加载失败兜底（I-8）', () => {
  let reload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    localStorage.clear();
    reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    reload.mockRestore();
  });

  it('chunk 加载失败 → reload 一次；二次触发不再 reload（防循环生效）', () => {
    const err = CHUNK_ERR();
    recoverFromChunkLoadError(err);
    expect(reload).toHaveBeenCalledTimes(1);

    recoverFromChunkLoadError(CHUNK_ERR());
    expect(reload).toHaveBeenCalledTimes(1); // sessionStorage 标记拦截
    expect(window.sessionStorage.getItem('router:chunk-reload')).toBe('1');
  });

  it('非 chunk 错误不触发 reload', () => {
    recoverFromChunkLoadError(new Error('Navigation cancelled'));
    recoverFromChunkLoadError('string error');
    expect(reload).not.toHaveBeenCalled();
  });

  it('兜底注册在真实 router 上：懒加载组件 import 失败走 onError → reload', async () => {
    setStoredToken('tok'); // 过鉴权守卫
    router.addRoute({
      path: '/__boom__',
      name: '__boom__',
      component: () => Promise.reject(CHUNK_ERR()),
    });
    try {
      await expect(router.push('/__boom__')).rejects.toThrow();
      expect(reload).toHaveBeenCalledTimes(1);
      // 防循环：同会话第二次失败不再 reload
      await expect(router.push('/__boom__')).rejects.toThrow();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      router.removeRoute('__boom__');
    }
  });
});
