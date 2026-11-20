/**
 * I-2 RED — 登录页 401 不整页刷新（真实接线测试）。
 * api/index.ts 的 onUnauthorized 之前无条件 assign(loginRedirectUrl(...))，
 * 而登录页的 loginRedirectUrl 返回 '/login' —— 同址 assign = 整页 reload，
 * LoginView catch 设置的行内错误提示永远不展示。
 * 预期：当前已在 /login 时短路（401 属预期失败，交给表单错误展示）；
 * 非 login 路径仍跳登录（对照）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, SNAPSHOT_AT_KEY } from './index';
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

/**
 * 快照时间戳记录（离线标识条「数据截至」的数据源）：
 * 快照接口（items/categories/shopping-items）GET 200 成功 → 写 SNAPSHOT_AT_KEY；
 * 非快照接口、失败响应、写请求一律不写。
 */
describe('api/index.ts 快照时间戳 recordingFetch', () => {
  function stubOkFetch(dateHeader?: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            ...(dateHeader ? { date: dateHeader } : {}),
          },
        }),
      ),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setStoredToken('some-token');
    stubOkFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('快照接口 GET 200 → 写时间戳', async () => {
    await api.listItems();
    expect(localStorage.getItem(SNAPSHOT_AT_KEY)).not.toBeNull();
  });

  it('响应带 Date 头 → 写服务器生成时刻而非本机当下（评审 I-8：SW 缓存回落保留原始 Date 头）', async () => {
    const serverDate = 'Mon, 01 Jan 2024 00:00:00 GMT';
    stubOkFetch(serverDate);
    await api.listItems();
    expect(localStorage.getItem(SNAPSHOT_AT_KEY)).toBe(String(Date.parse(serverDate)));
  });

  it('响应无 Date 头 → 回退本机时间', async () => {
    await api.listItems();
    const at = Number(localStorage.getItem(SNAPSHOT_AT_KEY));
    expect(Number.isFinite(at)).toBe(true);
    expect(Math.abs(at - Date.now())).toBeLessThan(5000);
  });

  it('非快照接口不写时间戳', async () => {
    await api.listNotifications();
    expect(localStorage.getItem(SNAPSHOT_AT_KEY)).toBeNull();
  });

  it('写请求（POST /items）不写时间戳', async () => {
    const dto = { name: 'x' } as unknown as Parameters<typeof api.createItem>[0];
    await api.createItem(dto);
    expect(localStorage.getItem(SNAPSHOT_AT_KEY)).toBeNull();
  });
});
