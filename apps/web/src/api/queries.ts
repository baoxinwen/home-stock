/**
 * 物品查询辅助：server 未提供 GET /items/:id，
 * 详情/编辑页从列表定位（先 active 再 archived），保持契约不猜接口。
 */
import type { ItemDto } from '@home-stock/shared';
import { API_ERROR_CODES } from '@home-stock/shared';
import { api } from './index';
import { ApiError } from './api';

export async function findItem(id: number): Promise<ItemDto> {
  const active = await api.listItems();
  const hit = active.find((i) => i.id === id);
  if (hit) return hit;
  const archived = await api.listItems({ status: 'archived' });
  const archivedHit = archived.find((i) => i.id === id);
  if (!archivedHit) throw new ApiError(API_ERROR_CODES.ITEM_NOT_FOUND, '物品不存在或已被删除');
  return archivedHit;
}
