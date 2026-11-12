/**
 * ApiError 与 api 封装的错误处理（TDD RED）。
 * 契约依据 packages/shared/src/api.ts 与 apps/server controller：
 * 成功包装 { data }，错误 { code, message }。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';
import { API_ERROR_CODES } from '@home-stock/shared';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiError', () => {
  it('carries code and message', () => {
    const e = new ApiError(API_ERROR_CODES.VALIDATION_ERROR, 'bad');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toBe('bad');
    expect(e instanceof Error).toBe(true);
  });
});

describe('createApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unwraps { data } on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: [{ id: 1, name: '牛奶' }] }));
    const client = createApiClient({ baseUrl: '/api' });
    const items = await client.listItems();
    expect(items).toEqual([{ id: 1, name: '牛奶' }]);
  });

  it('throws ApiError with server code/message on error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ code: 'ITEM_NOT_FOUND', message: '物品不存在' }, 404),
    );
    const client = createApiClient({ baseUrl: '/api' });
    await expect(client.archiveItem(99, { reason: 'used_up' })).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
      message: '物品不存在',
    });
  });

  it('throws ApiError with INTERNAL_ERROR shape when body is not json', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('server exploded', { status: 500 }),
    );
    const client = createApiClient({ baseUrl: '/api' });
    const err = await client.listItems().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('INTERNAL_ERROR');
  });

  it('sends JSON body and method for create', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: { id: 1 } }));
    const client = createApiClient({ baseUrl: '/api' });
    await client.createItem({ name: '牛奶' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/items');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: '牛奶' });
  });

  it('hits archive/restore/history endpoints with right urls', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ data: {} }));
    const client = createApiClient({ baseUrl: '/api' });
    await client.archiveItem(5, { reason: 'used_up' });
    await client.restoreItem(5);
    await client.listHistory('牛');
    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual(['/api/items/5/archive', '/api/items/5/restore', '/api/items/history?q=%E7%89%9B']);
  });

  it('injects auth token header when set (X-Access-Token 预留点)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: {} }));
    const client = createApiClient({ baseUrl: '/api', getToken: () => 'tok-1' });
    await client.listItems();
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Access-Token']).toBe('tok-1');
  });

  it('hits shopping endpoints with right urls/methods (M5)', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ data: {} }));
    const client = createApiClient({ baseUrl: '/api' });
    await client.listShoppingItems('done');
    await client.createShoppingItem({ name: '牛奶', quantity: 2 });
    await client.updateShoppingItem(3, { status: 'done' });
    await client.convertShoppingItem(3);
    await client.deleteShoppingItem(3);
    await client.clearConvertedShoppingItems();

    const calls = vi
      .mocked(fetch)
      .mock.calls.map((c) => [c[0] as string, ((c[1] as RequestInit).method ?? 'GET') as string]);
    expect(calls).toEqual([
      ['/api/shopping-items?status=done', 'GET'],
      ['/api/shopping-items', 'POST'],
      ['/api/shopping-items/3', 'PUT'],
      ['/api/shopping-items/3/convert', 'POST'],
      ['/api/shopping-items/3', 'DELETE'],
      ['/api/shopping-items/converted', 'DELETE'],
    ]);
  });

  it('hits stats waste endpoint with period/groupBy (M10)', async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ data: {} }));
    const client = createApiClient({ baseUrl: '/api' });
    await client.getWasteStats({ period: '2026-01', groupBy: 'month' });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toBe('/api/stats/waste?period=2026-01&groupBy=month');
  });

  it('passes list query params (q/category/status)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = createApiClient({ baseUrl: '/api' });
    await client.listItems({ q: '牛', category: 2, status: 'archived' });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toBe('/api/items?q=%E7%89%9B&category=2&status=archived');
  });

  it('401 → 调用 onUnauthorized 并抛 UNAUTHORIZED（前端跳登录页钩子）', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ code: 'UNAUTHORIZED', message: '访问口令缺失或错误' }, 401),
    );
    const onUnauthorized = vi.fn();
    const client = createApiClient({ baseUrl: '/api', getToken: () => 'stale', onUnauthorized });
    const err = await client.listItems().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('UNAUTHORIZED');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('非 401 错误不触发 onUnauthorized', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ code: 'INTERNAL_ERROR', message: 'x' }, 500));
    const onUnauthorized = vi.fn();
    const client = createApiClient({ baseUrl: '/api', onUnauthorized });
    await client.listItems().catch(() => undefined);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  describe('downloadBackup（I-7：Header 鉴权 + blob 触发保存）', () => {
    type DownloadCapable = { downloadBackup(): Promise<void> };
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;
    const urlCtor = URL as unknown as Record<string, unknown>;
    let origCreate: unknown;
    let origRevoke: unknown;

    beforeEach(() => {
      origCreate = urlCtor.createObjectURL;
      origRevoke = urlCtor.revokeObjectURL;
      createObjectURL = vi.fn(() => 'blob:mock');
      revokeObjectURL = vi.fn();
      urlCtor.createObjectURL = createObjectURL;
      urlCtor.revokeObjectURL = revokeObjectURL;
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
      clickSpy.mockRestore();
      if (origCreate === undefined) delete urlCtor.createObjectURL;
      else urlCtor.createObjectURL = origCreate;
      if (origRevoke === undefined) delete urlCtor.revokeObjectURL;
      else urlCtor.revokeObjectURL = origRevoke;
    });

    function sqliteResponse(filename: string | null): Response {
      const headers: Record<string, string> = { 'content-type': 'application/x-sqlite3' };
      if (filename) headers['content-disposition'] = `attachment; filename="${filename}"`;
      return new Response(new Blob(['sqlite-bytes'], { type: 'application/x-sqlite3' }), { status: 200, headers });
    }

    it('Header 鉴权请求 /api/backup，URL 不带 ?token=（不再产生 query 口令流量）', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(sqliteResponse('stock-2026.db'));
      const client = createApiClient({ baseUrl: '/api', getToken: () => 'tok-1' });
      await (client as unknown as DownloadCapable).downloadBackup();

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/backup');
      expect(url).not.toContain('token=');
      expect((init.headers as Record<string, string>)['X-Access-Token']).toBe('tok-1');
    });

    it('创建 <a download> 触发保存；文件名取 Content-Disposition', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(sqliteResponse('stock-20261107-010101.db'));
      const client = createApiClient({ baseUrl: '/api', getToken: () => 'tok-1' });
      await (client as unknown as DownloadCapable).downloadBackup();

      expect(clickSpy).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement | undefined;
      expect(anchor?.download).toBe('stock-20261107-010101.db');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('无 Content-Disposition → 默认 stock-<ts>.db 文件名', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(sqliteResponse(null));
      const client = createApiClient({ baseUrl: '/api', getToken: () => 'tok-1' });
      await (client as unknown as DownloadCapable).downloadBackup();

      const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement | undefined;
      expect(anchor?.download).toMatch(/^stock-\d+\.db$/);
    });

    it('401 → 调用 onUnauthorized 并抛 UNAUTHORIZED', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({ code: 'UNAUTHORIZED', message: '访问口令缺失或错误' }, 401),
      );
      const onUnauthorized = vi.fn();
      const client = createApiClient({ baseUrl: '/api', getToken: () => 'stale', onUnauthorized });
      await expect((client as unknown as DownloadCapable).downloadBackup()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('200 但响应不是备份文件（如 JSON 错误页）→ 抛错，不落盘', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const client = createApiClient({ baseUrl: '/api', getToken: () => 'tok-1' });
      await expect((client as unknown as DownloadCapable).downloadBackup()).rejects.toBeInstanceOf(ApiError);
      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  it('listBackups → GET /api/backup/list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: [{ name: 'stock-1.db', size: 10, createdAt: '2026-01-01T00:00:00Z' }] }),
    );
    const client = createApiClient({ baseUrl: '/api' });
    const list = await client.listBackups();
    expect(list[0].name).toBe('stock-1.db');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/backup/list');
  });

  it('restoreBackup → multipart POST，且不设置 JSON Content-Type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { restored: { items: 1 }, safetyBackup: 'pre-restore-1.db' } }),
    );
    const client = createApiClient({ baseUrl: '/api', getToken: () => 'tok' });
    const file = new File(['sqlite'], 'backup.db', { type: 'application/x-sqlite3' });
    const result = await client.restoreBackup(file);
    expect(result.safetyBackup).toBe('pre-restore-1.db');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/backup/restore');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['X-Access-Token']).toBe('tok');
  });
});
