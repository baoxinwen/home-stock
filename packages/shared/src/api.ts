/**
 * API 契约（契约先行：server 与 web 均从此导入，禁止各自手写）。
 * 覆盖规格第 7 节 REST API 概览（items/categories 部分）与第 9 节统一错误结构。
 */

/** 归档去向（规格第 3 节共识 #11：用完 / 过期丢弃） */
export const ARCHIVE_REASONS = ['used_up', 'expired_discarded'] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

/** 临期状态（列表计算字段） */
export const EXPIRY_STATUSES = ['none', 'ok', 'expiring', 'expired'] as const;
export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number];

/** 统一错误码（规格第 9 节 { code, message }） */
export const API_ERROR_CODES = {
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  ARCHIVE_REASON_INVALID: 'ARCHIVE_REASON_INVALID',
  DUPLICATE_NAME: 'DUPLICATE_NAME',
  NOT_FOUND: 'NOT_FOUND',
  ITEM_ALREADY_CONVERTED: 'ITEM_ALREADY_CONVERTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** 访问口令缺失或错误（M9.2） */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 已有恢复任务正在进行（并发恢复保护） */
  RESTORE_IN_PROGRESS: 'RESTORE_IN_PROGRESS',
  /** 恢复流程失败（已尽量回滚） */
  RESTORE_FAILED: 'RESTORE_FAILED',
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/** 统一错误形状（规格第 9 节） */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

/** 统一成功响应包装 */
export interface ApiResponse<T> {
  data: T;
}

// ---------- 类别 ----------

export interface CategoryDto {
  id: number;
  name: string;
  sortOrder: number | null;
}

export interface CategoryCreateDto {
  name: string;
  sortOrder?: number | null;
}

export type CategoryUpdateDto = Partial<CategoryCreateDto>;

// ---------- 物品 ----------

export type ItemStatus = 'active' | 'archived';

/** 物品来源：manual=手动录入；shopping=购物清单转库存（M5.3 待补过期日仅对 shopping 生效） */
export const ITEM_SOURCES = ['manual', 'shopping'] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/** 物品（列表/详情响应）：含 server 计算出的有效过期日与临期状态 */
export interface ItemDto {
  id: number;
  name: string;
  categoryId: number | null;
  purchaseDate: string | null;
  quantity: number;
  unit: string | null;
  price: number | null;
  expiryDate: string | null;
  opened: number;
  openedAt: string | null;
  openShelfDays: number | null;
  remindDays: number | null;
  minQuantity: number | null;
  status: ItemStatus;
  archivedReason: ArchiveReason | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** manual=手动录入 / shopping=购物清单转库存 */
  source: ItemSource;
  /** 物品图片（0006，P1 单图）：uploads/ 下随机文件名，null=无图；URL 走 /api/uploads/:file?token= */
  imagePath: string | null;
  /** server 计算的有效过期日（YYYY-MM-DD，可空=长期存储品） */
  effectiveExpiryDate: string | null;
  /** none=无过期概念 / ok=未到期 / expiring=≤阈值 / expired=已过期 */
  expiryStatus: ExpiryStatus;
}

export interface ItemCreateDto {
  name: string;
  categoryId?: number | null;
  purchaseDate?: string | null;
  quantity?: number;
  unit?: string | null;
  price?: number | null;
  /** server 只收换算结果，生产日期+保质期换算由前端完成 */
  expiryDate?: string | null;
  openShelfDays?: number | null;
  remindDays?: number | null;
  minQuantity?: number | null;
  /** 物品图片（可选）：先 POST /api/uploads 得到文件名再带入；格式由 server 校验 */
  imagePath?: string | null;
}

/** 部分更新；opened 置 1 时 server 写 opened_at=当日，置 0 时清空 */
export type ItemUpdateDto = Partial<Omit<ItemCreateDto, 'name'>> & {
  name?: string;
  opened?: number;
};

/** 历史物品快速复制模板字段（M1.5） */
export interface ItemHistoryDto {
  id: number;
  name: string;
  categoryId: number | null;
  unit: string | null;
  price: number | null;
  expiryDate: string | null;
  openShelfDays: number | null;
  remindDays: number | null;
}

/** GET /items 与 GET /items/history 查询参数 */
export interface ListItemsQuery {
  q?: string;
  category?: number;
  /** active（默认）/ archived */
  status?: ItemStatus;
}

/** POST /items/:id/archive 请求体 */
export interface ArchiveItemRequest {
  reason: ArchiveReason;
}

// ---------- 购物清单 ----------

/** 清单项状态：待购 / 已完成 / 已转库存（M5.1/M5.2） */
export const SHOPPING_ITEM_STATUSES = ['pending', 'done', 'converted'] as const;
export type ShoppingItemStatus = (typeof SHOPPING_ITEM_STATUSES)[number];

/** PUT 允许流转的状态：converted 只能由 convert 接口产生 */
export type ShoppingItemMutableStatus = Exclude<ShoppingItemStatus, 'converted'>;

export interface ShoppingItemDto {
  id: number;
  name: string;
  quantity: number;
  unit: string | null;
  price: number | null;
  categoryId: number | null;
  status: ShoppingItemStatus;
}

export interface ShoppingItemCreateDto {
  name: string;
  /** 可选，默认 1 */
  quantity?: number;
  unit?: string | null;
  price?: number | null;
  categoryId?: number | null;
}

/** 部分更新：勾选完成 / 改回待购走 status */
export type ShoppingItemUpdateDto = Partial<ShoppingItemCreateDto> & {
  status?: ShoppingItemMutableStatus;
};

/** POST /shopping-items/:id/convert 响应：新库存物品 + 已转换的清单项 */
export interface ConvertResult {
  item: ItemDto;
  shoppingItem: ShoppingItemDto;
}

/**
 * 转库存表单确认 payload（可选字段）。
 * 传入时物品完全按 payload 生成（表单预填清单项字段、用户确认/修改后提交）；
 * 不传或空对象 = 快捷转换（批量一键，物品按清单项字段生成、过期日期为空走待补兜底）。
 */
export interface ConvertItemPayloadDto {
  name?: string;
  categoryId?: number | null;
  purchaseDate?: string | null;
  quantity?: number;
  unit?: string | null;
  price?: number | null;
  expiryDate?: string | null;
  openShelfDays?: number | null;
  remindDays?: number | null;
  minQuantity?: number | null;
}

// ---------- 浪费统计（M10） ----------

/** 统计分组维度：按类别（默认）/ 按月 */
export const WASTE_GROUP_BYS = ['category', 'month'] as const;
export type WasteGroupBy = (typeof WASTE_GROUP_BYS)[number];

/** 类别浪费分桶（M10.2）：未分类为 categoryId=null / categoryName='未分类' */
export interface WasteBucketDto {
  categoryId: number | null;
  categoryName: string;
  /** 件数（归档条目数，不是 quantity 求和） */
  count: number;
  /** 金额 = Σ(price×quantity)，四舍五入到 2 位 */
  amount: number;
}

/** 月份浪费分桶（groupBy=month）：period 指定单月的汇总桶 */
export interface WasteMonthBucketDto {
  /** YYYY-MM */
  month: string;
  count: number;
  amount: number;
}

/** GET /stats/waste 响应（空数据返回零值，不是 404） */
export interface WasteStatsDto {
  /** 统计月份 YYYY-MM（缺省为当月） */
  period: string;
  /** 浪费件数：仅 archived + expired_discarded，used_up 不计入 */
  totalCount: number;
  /** 浪费金额：Σ(price×quantity)，未填价格记 0 但仍计件数 */
  totalAmount: number;
  byCategory: WasteBucketDto[];
  /** 仅 groupBy=month 时返回 */
  byMonth?: WasteMonthBucketDto[];
}

/** GET /stats/waste 查询参数 */
export interface WasteStatsQuery {
  /** YYYY-MM，缺省当月 */
  period?: string;
  /** 默认 category */
  groupBy?: WasteGroupBy;
}

// ---------- 备份与恢复（M8） ----------

/** GET /backup/list 的一项：BACKUP_DIR 下的备份文件 */
export interface BackupFileDto {
  /** 文件名，如 stock-20261107-020000.db / pre-restore-20261107-020100.db */
  name: string;
  /** 字节数 */
  size: number;
  /** 文件修改时间（ISO 8601） */
  createdAt: string;
}

/** 恢复后各表行数摘要 */
export interface RestoreCountsDto {
  items: number;
  categories: number;
  shoppingItems: number;
  notifications: number;
  settings: number;
}

/** POST /backup/restore 成功响应 */
export interface RestoreResultDto {
  /** 恢复后的数据摘要（用于 UI 确认数据已回滚） */
  restored: RestoreCountsDto;
  /** 恢复前自动安全备份的文件名（位于 BACKUP_DIR） */
  safetyBackup: string;
}
