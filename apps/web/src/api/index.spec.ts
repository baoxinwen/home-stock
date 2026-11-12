/**
 * I-2 RED — 登录页 401 不整页刷新（真实接线测试）。
 * api/index.ts 的 onUnauthorized 之前无条件 assign(loginRedirectUrl(...))，
 * 而登录页的 loginRedirectUrl 返回 '/login' —— 同址 assign = 整页 reload，
 * LoginView catch 设置的行内错误提示永远不展示。
 * 预期：当前已在 /login 时短路（401 属预期失败，交给表单错误展示）；
 * 非 login 路径仍跳登录（对照）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './index';
import { setStoredToken } from '../auth/token';

function stub401Fetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: '访问口令缺失或错误' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('api/index.ts onUnauthorized 接线（I-2）', () => {
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setStoredToken('some-token');
    stub401Fetch();
    assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  });

  afterEach(() => {
    assign.mockRestore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('在 /login 页收到 401 → 不整页跳转（行内错误提示可展示）', async () => {
    window.history.pushState({}, '', '/login');
    await expect(api.listItems()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('非 login 路径收到 401 → 仍跳登录页并带 redirect（对照）', async () => {
    window.history.pushState({}, '', '/settings');
    await expect(api.listItems()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?redirect=%2Fsettings');
  });
});
