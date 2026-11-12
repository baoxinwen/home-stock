/**
 * M5.3「待补过期日」前端派生（D-3 修订：去掉 7 天窗口，欠账常驻可见）：
 * 仅对「购物清单转库存」来源（source=shopping）且未填过期日的物品提示，
 * 手动录入（source=manual）的长期存储品不提示（M3.4）。
 */
import type { ItemDto } from '@home-stock/shared';

export type ExpiryHintSource = Pick<ItemDto, 'source' | 'expiryDate' | 'effectiveExpiryDate'>;

export function needsExpiryDate(item: ExpiryHintSource): boolean {
  if (item.source !== 'shopping') return false;
  if (item.expiryDate || item.effectiveExpiryDate) return false;
  return true;
}
