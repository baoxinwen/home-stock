/**
 * 物品字段共享校验（评审 I-2/I-4）：items create/update 与清单 convert 表单路径
 * 是两条「创建物品」入口，此前 convert 对日期/阈值字段仅透传，脏值入库被当
 * 「长期存储品」（提醒静默失效），categoryId/unit 非标量直接 500。
 * 两条入口从此共用同一校验宽度。语义与原 items.assertCommon 一致：
 * undefined 跳过（未提供）、null 放行（=清除/未填）。
 */
import { API_ERROR_CODES, isValidISODate } from '@home-stock/shared';
import { ApiException } from './api.exception';

export interface ItemFieldChecks {
  quantity?: number;
  price?: number | null;
  expiryDate?: string | null;
  purchaseDate?: string | null;
  openShelfDays?: number | null;
  remindDays?: number | null;
  minQuantity?: number | null;
  categoryId?: number | null;
  unit?: string | null;
}

export function assertItemFields(f: ItemFieldChecks): void {
  if (f.quantity !== undefined) {
    if (typeof f.quantity !== 'number' || !Number.isFinite(f.quantity) || f.quantity < 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'quantity 必须为 >= 0 的数字');
    }
  }
  if (f.expiryDate != null && !isValidISODate(f.expiryDate)) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `expiry_date 非法：${String(f.expiryDate)}`);
  }
  if (f.purchaseDate != null && !isValidISODate(f.purchaseDate)) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `purchase_date 非法：${String(f.purchaseDate)}`);
  }
  if (f.price !== undefined && f.price !== null) {
    if (typeof f.price !== 'number' || !Number.isFinite(f.price) || f.price < 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'price 必须为 >= 0 的数字');
    }
  }
  if (f.openShelfDays != null) {
    if (!Number.isInteger(f.openShelfDays) || f.openShelfDays <= 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'open_shelf_days 必须为正整数');
    }
  }
  // minQuantity 是低库存判定的阈值字段——脏值入库会让前端低库存判定恒 false 且无从排查
  if (f.minQuantity !== undefined && f.minQuantity !== null) {
    if (typeof f.minQuantity !== 'number' || !Number.isFinite(f.minQuantity) || f.minQuantity < 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'minQuantity 必须为 >= 0 的数字');
    }
  }
  if (f.remindDays != null) {
    if (!Number.isInteger(f.remindDays) || f.remindDays <= 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'remind_days 必须为正整数');
    }
  }
  if (f.categoryId != null && !Number.isInteger(f.categoryId)) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'category_id 必须为正整数');
  }
  // 自由字符串字段必须为字符串或 null——对象/数组透传到 better-sqlite3 绑定会 500 而非 400
  if (f.unit !== undefined && f.unit !== null && typeof f.unit !== 'string') {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'unit 必须为字符串');
  }
}
