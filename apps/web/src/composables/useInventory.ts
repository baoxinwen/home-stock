/**
 * 库存主屏 composable：搜索防抖 300ms、类别筛选、列表加载。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import type { CategoryDto, ItemDto } from '@home-stock/shared';
import { api } from '../api';
import { useDebounced } from '../lib/debounce';

export function useInventory() {
  const items = ref<ItemDto[]>([]);
  const categories = ref<CategoryDto[]>([]);
  const searchInput = ref('');
  const query = ref('');
  const activeCategory = ref<number | null>(null);
  const loading = ref(false);
  const error = ref('');

  /** 请求序号（I-5，同 StatsView 先例）：搜索/筛选快速切换时丢弃过期响应 */
  let requestSeq = 0;

  async function load(): Promise<void> {
    const seq = ++requestSeq;
    loading.value = true;
    error.value = '';
    try {
      const data = await api.listItems({
        q: query.value || undefined,
        category: activeCategory.value ?? undefined,
      });
      if (seq !== requestSeq) return; // 已有更新的请求，过期响应不落状态
      items.value = data;
    } catch (e) {
      if (seq !== requestSeq) return;
      error.value = e instanceof Error ? e.message : '加载失败，请重试';
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  }

  const debouncedSearch = useDebounced((v: string) => {
    query.value = v;
    void load();
  }, 300);

  // M18：卸载时清掉未触发的防抖定时器，避免卸载后多发请求
  onUnmounted(() => debouncedSearch.cancel());

  function onSearchInput(v: string): void {
    searchInput.value = v;
    debouncedSearch(v);
  }

  function toggleCategory(id: number | null): void {
    activeCategory.value = activeCategory.value === id ? null : id;
    void load();
  }

  onMounted(async () => {
    void load();
    try {
      categories.value = await api.listCategories();
    } catch {
      /* 类别加载失败不阻塞列表 */
    }
  });

  return {
    items,
    categories,
    searchInput,
    /** 已生效的搜索词（防抖后随 load 更新；空态区分用，M13） */
    query,
    activeCategory,
    loading,
    error,
    onSearchInput,
    toggleCategory,
    reload: load,
  };
}
