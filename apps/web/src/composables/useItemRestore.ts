/**
 * 物品恢复流程（C-1/I-4 共享）：归档页与物品详情/抽屉共用同一执行语义。
 * - postponeAndRestore：顺延过期日 7 天（本地口径）并恢复；
 *   同时清开封（C-1 根因修复）——开封品的有效过期日按 openedAt+openShelfDays
 *   优先计算，只顺延 expiryDate 挡不住次日再次自动归档；清开封后回落到顺延值。
 * - forceRestore：仍恢复，接受再次被自动归档的后果（面板文案已明示）。
 * onDone 由宿主刷新列表/详情；onError 由宿主展示错误。
 */
import { ref } from 'vue';
import { addDaysISO } from '@home-stock/shared';
import { api } from '../api';
import { todayISO } from '../lib/dates';

export function useItemRestore(handlers: {
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const restoringId = ref<number | null>(null);

  async function postponeAndRestore(id: number): Promise<void> {
    restoringId.value = id;
    try {
      // W-M1：以本地今天为基准顺延（原 toISOString 取 UTC 日，东八区凌晨只顺延 6 天）
      const newExpiry = addDaysISO(todayISO(), 7);
      await api.updateItem(id, { expiryDate: newExpiry, opened: 0 });
      await api.restoreItem(id);
      restoringId.value = null;
      await handlers.onDone();
    } catch (e) {
      restoringId.value = null;
      handlers.onError(e instanceof Error ? e.message : '操作失败');
    }
  }

  async function forceRestore(id: number): Promise<void> {
    restoringId.value = id;
    try {
      await api.restoreItem(id);
      restoringId.value = null;
      await handlers.onDone();
    } catch (e) {
      restoringId.value = null;
      handlers.onError(e instanceof Error ? e.message : '恢复失败');
    }
  }

  return { restoringId, postponeAndRestore, forceRestore };
}
