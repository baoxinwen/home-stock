import { describe, it, expect } from 'vitest';
import {
  API_ERROR_CODES,
  ARCHIVE_REASONS,
  EXPIRY_STATUSES,
  ITEM_SOURCES,
  SHOPPING_ITEM_STATUSES,
  type ApiError,
  type ItemDto,
  type ItemCreateDto,
  type ItemUpdateDto,
  type CategoryDto,
  type ItemHistoryDto,
  type ListItemsQuery,
  type ApiResponse,
  type ArchiveReason,
  type ExpiryStatus,
  type ApiErrorCode,
  type ItemSource,
  type ShoppingItemDto,
  type ShoppingItemCreateDto,
  type ShoppingItemUpdateDto,
  type ConvertResult,
  WASTE_GROUP_BYS,
  type WasteStatsDto,
  type WasteBucketDto,
  type WasteMonthBucketDto,
  type WasteStatsQuery,
} from '../src/api';

describe('API 错误码契约（规格第 9 节统一错误结构）', () => {
  it('定义统一错误码集合', () => {
    expect(API_ERROR_CODES.ITEM_NOT_FOUND).toBe('ITEM_NOT_FOUND');
    expect(API_ERROR_CODES.CATEGORY_NOT_FOUND).toBe('CATEGORY_NOT_FOUND');
    expect(API_ERROR_CODES.CATEGORY_IN_USE).toBe('CATEGORY_IN_USE');
    expect(API_ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(API_ERROR_CODES.ARCHIVE_REASON_INVALID).toBe('ARCHIVE_REASON_INVALID');
    expect(API_ERROR_CODES.DUPLICATE_NAME).toBe('DUPLICATE_NAME');
    expect(API_ERROR_CODES.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(API_ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    // M9.2 访问口令：未授权统一错误码
    expect(API_ERROR_CODES.UNAUTHORIZED).toBe('UNAUTHORIZED');
  });

  it('ApiError 形状为 { code, message }', () => {
    const err: ApiError = { code: 'ITEM_NOT_FOUND', message: '物品不存在' };
    expect(err.code).toBeDefined();
    expect(err.message).toBeDefined();
  });
});

describe('枚举契约', () => {
  it('归档去向仅 用完/过期丢弃（规格第 3 节共识 #11）', () => {
    expect(ARCHIVE_REASONS).toEqual(['used_up', 'expired_discarded']);
    const r: ArchiveReason = 'used_up';
    expect(r).toBe('used_up');
  });

  it('临期状态为 none|ok|expiring|expired', () => {
    expect(EXPIRY_STATUSES).toEqual(['none', 'ok', 'expiring', 'expired']);
    const s: ExpiryStatus = 'expiring';
    const c: ApiErrorCode = 'ITEM_NOT_FOUND';
    expect([s, c]).toEqual(['expiring', 'ITEM_NOT_FOUND']);
  });

  it('物品来源为 manual|shopping（M5.3 待补过期日仅对 shopping 生效）', () => {
    expect(ITEM_SOURCES).toEqual(['manual', 'shopping']);
    const src: ItemSource = 'shopping';
    expect(src).toBe('shopping');
  });
});

describe('DTO 契约形状', () => {
  it('ItemDto 含计算字段 effectiveExpiryDate 与 expiryStatus', () => {
    const item: ItemDto = {
      id: 1,
      name: '牛奶',
      categoryId: 1,
      purchaseDate: null,
      quantity: 2,
      unit: '盒',
      price: 12,
      expiryDate: '2026-11-09',
      opened: 0,
      openedAt: null,
      openShelfDays: null,
      remindDays: null,
      minQuantity: null,
      status: 'active',
      archivedReason: null,
      archivedAt: null,
      createdAt: null,
      updatedAt: null,
      source: 'manual',
      effectiveExpiryDate: '2026-11-09',
      expiryStatus: 'ok',
    };
    expect(item.effectiveExpiryDate).toBe('2026-11-09');
  });

  it('ItemCreateDto 仅需 name，其余可选', () => {
    const minimal: ItemCreateDto = { name: '牛奶' };
    const full: ItemCreateDto = {
      name: '牛奶',
      categoryId: 1,
      purchaseDate: '2026-11-06',
      quantity: 2,
      unit: '盒',
      price: 12.5,
      expiryDate: '2026-11-09',
      openShelfDays: 3,
      remindDays: 5,
      minQuantity: 1,
    };
    expect(minimal.quantity).toBeUndefined();
    expect(full.openShelfDays).toBe(3);
  });

  it('ItemUpdateDto 为部分更新且可改开封状态', () => {
    const patch: ItemUpdateDto = { quantity: 0, opened: 1 };
    expect(patch.opened).toBe(1);
  });

  it('CategoryDto / 归档请求 / 列表查询参数 / 历史模板', () => {
    const cat: CategoryDto = { id: 1, name: '食品', sortOrder: 1 };
    const q: ListItemsQuery = { q: '牛奶', category: 1, status: 'archived' };
    const h: ItemHistoryDto = {
      id: 3,
      name: '牛奶',
      categoryId: 1,
      unit: '盒',
      price: 12,
      expiryDate: null,
      openShelfDays: null,
      remindDays: null,
    };
    expect(cat.sortOrder).toBe(1);
    expect(q.status).toBe('archived');
    expect(h.name).toBe('牛奶');
  });

  it('购物清单契约：状态枚举、错误码与 DTO / ConvertResult 形状（M5）', () => {
    expect(SHOPPING_ITEM_STATUSES).toEqual(['pending', 'done', 'converted']);
    expect(API_ERROR_CODES.ITEM_ALREADY_CONVERTED).toBe('ITEM_ALREADY_CONVERTED');

    const shopping: ShoppingItemDto = {
      id: 1,
      name: '牛奶',
      quantity: 2,
      unit: '盒',
      price: 12,
      categoryId: null,
      status: 'done',
    };
    const create: ShoppingItemCreateDto = { name: '纸巾' };
    const update: ShoppingItemUpdateDto = { status: 'pending' };
    const item: ItemDto = {
      id: 10,
      name: '牛奶',
      categoryId: null,
      purchaseDate: null,
      quantity: 2,
      unit: '盒',
      price: 12,
      expiryDate: null,
      opened: 0,
      openedAt: null,
      openShelfDays: null,
      remindDays: null,
      minQuantity: null,
      status: 'active',
      archivedReason: null,
      archivedAt: null,
      createdAt: null,
      updatedAt: null,
      source: 'manual',
      effectiveExpiryDate: null,
      expiryStatus: 'none',
    };
    const converted: ConvertResult = {
      item,
      shoppingItem: { ...shopping, status: 'converted' },
    };
    expect(create.quantity).toBeUndefined();
    expect(update.status).toBe('pending');
    expect(converted.item.expiryDate).toBeNull();
    expect(converted.shoppingItem.status).toBe('converted');
  });

  it('浪费统计契约：分组枚举与 DTO 形状（M10.1/M10.2）', () => {
    expect(WASTE_GROUP_BYS).toEqual(['category', 'month']);

    const bucket: WasteBucketDto = {
      categoryId: null,
      categoryName: '未分类',
      count: 3,
      amount: 30,
    };
    const months: WasteMonthBucketDto[] = [{ month: '2026-01', count: 3, amount: 30 }];
    const data: WasteStatsDto = {
      period: '2026-01',
      totalCount: 3,
      totalAmount: 30,
      byCategory: [bucket],
      byMonth: months,
    };
    const query: WasteStatsQuery = { period: '2026-01', groupBy: 'month' };

    expect(data.byCategory[0].count).toBe(3);
    expect(data.byMonth?.[0].month).toBe('2026-01');
    expect(query.groupBy).toBe('month');
  });

  it('统一响应包装 ApiResponse<T>', () => {
    const ok: ApiResponse<ItemDto> = {
      data: {
        id: 1,
        name: 'x',
        categoryId: null,
        purchaseDate: null,
        quantity: 0,
        unit: null,
        price: null,
        expiryDate: null,
        opened: 0,
        openedAt: null,
        openShelfDays: null,
        remindDays: null,
        minQuantity: null,
        status: 'active',
        archivedReason: null,
        archivedAt: null,
        createdAt: null,
        updatedAt: null,
        source: 'manual',
        effectiveExpiryDate: null,
        expiryStatus: 'none',
      },
    };
    const list: ApiResponse<ItemDto[]> = { data: [] };
    expect(ok.data.id).toBe(1);
    expect(list.data).toEqual([]);
  });
});
