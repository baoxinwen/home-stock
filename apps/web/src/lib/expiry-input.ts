/**
 * 生产日期 + 保质期时长 → 过期日期（前端换算后回填 expiryDate，server 只收结果）。
 * 复用 shared 的 addDaysISO / isValidISODate（契约一致，纯字符串计算无时区偏移）。
 */
import { addDaysISO, isValidISODate } from '@home-stock/shared';

export function computeExpiryFromShelfLife(
  productionDate: string | null | undefined,
  shelfLifeDays: number | null | undefined,
): string | null {
  if (!isValidISODate(productionDate)) return null;
  if (typeof shelfLifeDays !== 'number' || !Number.isFinite(shelfLifeDays) || shelfLifeDays <= 0) {
    return null;
  }
  return addDaysISO(productionDate, Math.trunc(shelfLifeDays));
}
