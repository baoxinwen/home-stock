/**
 * 详情页 composable：加载、归档/恢复/删除。
 * server 未提供 GET /items/:id —— 从列表定位（见 api/queries.findItem）。
 */
import { onMounted, ref } from 'vue';
import type { ArchiveReason, ItemDto } from '@home-stock/shared';
import { api } from '../api';
import { findItem } from '../api/queries';

export function useItemDetail(id: number) {
  const item = ref<ItemDto | null>(null);
  const loading = ref(false);
  const error = ref('');

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      item.value = await findItem(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败';
    } finally {
      loading.value = false;
    }
  }

  async function archive(reason: ArchiveReason): Promise<ItemDto> {
    const updated = await api.archiveItem(id, { reason });
    item.value = updated;
    return updated;
  }

  async function restore(): Promise<void> {
    item.value = await api.restoreItem(id);
  }

  async function remove(): Promise<void> {
    await api.deleteItem(id);
  }

  onMounted(load);

  return { item, loading, error, load, archive, restore, remove };
}
