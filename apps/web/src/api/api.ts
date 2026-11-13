/**
 * 类型安全 api 封装（契约依据 packages/shared/src/api.ts）。
 * - 统一解包 { data }
 * - 错误统一抛 ApiError({ code, message })；非 JSON 错误体回退 INTERNAL_ERROR
 * - X-Access-Token 预留注入点（getToken）
 */
import type {
  MarkNotificationsDoneRequest,
  MarkNotificationsReadRequest,
  ArchiveItemRequest,
  ApiResponse,
  BackupFileDto,
  CategoryCreateDto,
  CategoryDto,
  CategoryUpdateDto,
  ConvertItemPayloadDto,
  ConvertResult,
  ItemCreateDto,
  ItemDto,
  ItemHistoryDto,
  ItemUpdateDto,
  ListItemsQuery,
  NotificationDto,
  NotificationLogDto,
  NotifyChannel,
  NotifyTestResult,
  ReminderRunResult,
  RestoreResultDto,
  SettingsDto,
  SettingsUpdateDto,
  ShoppingItemCreateDto,
  ShoppingItemDto,
  ShoppingItemStatus,
  ShoppingItemUpdateDto,
  WasteStatsDto,
  WasteStatsQuery,
} from '@home-stock/shared';
import { API_ERROR_CODES } from '@home-stock/shared';

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** 鉴权注入点：每次请求前取 token，设了就带 X-Access-Token */
  getToken?: () => string | null | undefined;
  /** 401 回调：清空本地口令并跳登录页（由 api/index.ts 注入） */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken?: () => string | null | undefined;
  private readonly onUnauthorized?: () => void;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api').replace(/\/$/, '');
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    };
    const token = this.getToken?.();
    if (token) headers['X-Access-Token'] = token;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(API_ERROR_CODES.INTERNAL_ERROR, '网络请求失败，请重试');
    }

    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        try {
          this.onUnauthorized?.();
        } catch {
          // 跳转失败不影响错误抛出
        }
      }
      const err = (body ?? {}) as { code?: unknown; message?: unknown };
      throw new ApiError(
        typeof err.code === 'string' ? err.code : API_ERROR_CODES.INTERNAL_ERROR,
        typeof err.message === 'string' ? err.message : `请求失败（HTTP ${res.status}）`,
      );
    }

    const wrapped = body as ApiResponse<T> | null;
    if (wrapped && typeof wrapped === 'object' && 'data' in wrapped) {
      return wrapped.data;
    }
    return body as T;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  // ---------- items ----------

  listItems(query: ListItemsQuery = {}): Promise<ItemDto[]> {
    return this.request<ItemDto[]>(`/items${this.buildQuery({ q: query.q, category: query.category, status: query.status })}`);
  }

  createItem(dto: ItemCreateDto): Promise<ItemDto> {
    return this.request<ItemDto>('/items', { method: 'POST', body: JSON.stringify(dto) });
  }

  updateItem(id: number, dto: ItemUpdateDto): Promise<ItemDto> {
    return this.request<ItemDto>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
  }

  deleteItem(id: number): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/items/${id}`, { method: 'DELETE' });
  }

  archiveItem(id: number, req: ArchiveItemRequest): Promise<ItemDto> {
    return this.request<ItemDto>(`/items/${id}/archive`, { method: 'POST', body: JSON.stringify(req) });
  }

  restoreItem(id: number): Promise<ItemDto> {
    return this.request<ItemDto>(`/items/${id}/restore`, { method: 'POST', body: JSON.stringify({}) });
  }

  listHistory(q = ''): Promise<ItemHistoryDto[]> {
    return this.request<ItemHistoryDto[]>(`/items/history${this.buildQuery({ q })}`);
  }

  // ---------- categories ----------

  listCategories(): Promise<CategoryDto[]> {
    return this.request<CategoryDto[]>('/categories');
  }

  createCategory(dto: CategoryCreateDto): Promise<CategoryDto> {
    return this.request<CategoryDto>('/categories', { method: 'POST', body: JSON.stringify(dto) });
  }

  updateCategory(id: number, dto: CategoryUpdateDto): Promise<CategoryDto> {
    return this.request<CategoryDto>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
  }

  deleteCategory(id: number): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/categories/${id}`, { method: 'DELETE' });
  }

  // ---------- shopping ----------

  listShoppingItems(status?: ShoppingItemStatus): Promise<ShoppingItemDto[]> {
    return this.request<ShoppingItemDto[]>(`/shopping-items${this.buildQuery({ status })}`);
  }

  createShoppingItem(dto: ShoppingItemCreateDto): Promise<ShoppingItemDto> {
    return this.request<ShoppingItemDto>('/shopping-items', { method: 'POST', body: JSON.stringify(dto) });
  }

  updateShoppingItem(id: number, dto: ShoppingItemUpdateDto): Promise<ShoppingItemDto> {
    return this.request<ShoppingItemDto>(`/shopping-items/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
  }

  deleteShoppingItem(id: number): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/shopping-items/${id}`, { method: 'DELETE' });
  }

  convertShoppingItem(id: number, payload?: ConvertItemPayloadDto): Promise<ConvertResult> {
    return this.request<ConvertResult>(`/shopping-items/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    });
  }

  clearConvertedShoppingItems(): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/shopping-items/converted', { method: 'DELETE' });
  }

  // ---------- stats ----------

  /** GET /stats/waste：浪费件数/金额，按类别或按月（M10） */
  getWasteStats(query: WasteStatsQuery = {}): Promise<WasteStatsDto> {
    return this.request<WasteStatsDto>(
      `/stats/waste${this.buildQuery({ period: query.period, groupBy: query.groupBy })}`,
    );
  }

  // ---------- settings / notifications / reminders ----------

  getSettings(): Promise<SettingsDto> {
    return this.request<SettingsDto>('/settings');
  }

  updateSettings(dto: SettingsUpdateDto): Promise<SettingsDto> {
    return this.request<SettingsDto>('/settings', { method: 'PUT', body: JSON.stringify(dto) });
  }

  notifyTest(channel: NotifyChannel): Promise<NotifyTestResult> {
    return this.request<NotifyTestResult>('/settings/notify-test', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    });
  }

  listNotifications(unreadOnly = false): Promise<NotificationDto[]> {
    return this.request<NotificationDto[]>(`/notifications${unreadOnly ? '?unread=1' : ''}`);
  }

  markNotificationsRead(ids?: MarkNotificationsReadRequest['ids']): Promise<{ updated: number }> {
    return this.request<{ updated: number }>('/notifications/read', {
      method: 'POST',
      body: JSON.stringify(ids && ids.length ? { ids } : {}),
    });
  }

  /** 标记完成（0004 done 语义）：ids 缺省=全部；完成同时置已读 */
  markNotificationsDone(ids?: MarkNotificationsDoneRequest['ids']): Promise<{ updated: number }> {
    return this.request<{ updated: number }>('/notifications/done', {
      method: 'POST',
      body: JSON.stringify(ids && ids.length ? { ids } : {}),
    });
  }

  /** 恢复到收件箱：清除 done */
  undoNotificationsDone(ids: MarkNotificationsDoneRequest['ids']): Promise<{ updated: number }> {
    return this.request<{ updated: number }>('/notifications/undone', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  listNotificationLogs(): Promise<NotificationLogDto[]> {
    return this.request<NotificationLogDto[]>('/notifications/logs');
  }

  runReminders(): Promise<ReminderRunResult> {
    return this.request<ReminderRunResult>('/reminders/run', { method: 'POST', body: JSON.stringify({}) });
  }

  // ---------- uploads（0006 物品图片） ----------

  /** 上传物品图片（multipart）：成功返回服务端随机文件名，写入物品 imagePath */
  uploadImage(file: File): Promise<{ path: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.request<{ path: string }>('/uploads', { method: 'POST', body: form });
  }

  // ---------- backup（M8 / I-7） ----------

  /**
   * 下载备份：fetch + Header 鉴权 → 校验响应 → blob → <a download> 触发保存（I-7）。
   * 口令只走 X-Access-Token，不再出现在 URL（不产生 query 口令流量，浏览器也不再
   * 直接渲染 JSON 错误页）；401 走既有 onUnauthorized，失败抛 ApiError 由调用方提示。
   * server 侧 ?token= 已同步收窄为仅备份下载端点可用。
   */
  async downloadBackup(): Promise<void> {
    const headers: Record<string, string> = {};
    const token = this.getToken?.();
    if (token) headers['X-Access-Token'] = token;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/backup`, { headers });
    } catch {
      throw new ApiError(API_ERROR_CODES.INTERNAL_ERROR, '网络请求失败，请重试');
    }

    if (!res.ok) {
      if (res.status === 401) {
        try {
          this.onUnauthorized?.();
        } catch {
          // 跳转失败不影响错误抛出
        }
      }
      let code: string = API_ERROR_CODES.INTERNAL_ERROR;
      let message = `下载失败（HTTP ${res.status}）`;
      try {
        const body = (await res.json()) as { code?: unknown; message?: unknown };
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.message === 'string') message = body.message;
      } catch {
        // 非 JSON 错误体保持默认
      }
      throw new ApiError(code, message);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('x-sqlite3')) {
      throw new ApiError(API_ERROR_CODES.INTERNAL_ERROR, '响应不是有效的备份文件');
    }

    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] ?? `stock-${Date.now()}.db`;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  listBackups(): Promise<BackupFileDto[]> {
    return this.request<BackupFileDto[]>('/backup/list');
  }

  /** 上传恢复（multipart，字段名 file） */
  restoreBackup(file: File | Blob, filename = 'backup.db'): Promise<RestoreResultDto> {
    const form = new FormData();
    const name = typeof (file as File).name === 'string' && (file as File).name ? (file as File).name : filename;
    form.append('file', file, name);
    return this.request<RestoreResultDto>('/backup/restore', { method: 'POST', body: form });
  }
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return new ApiClient(options);
}
