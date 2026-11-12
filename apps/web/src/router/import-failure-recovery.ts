/**
 * 动态导入失败的自愈恢复（router.onError 用，I-8）：
 * vite dev 重启 / PWA autoUpdate 换 hash 后，旧标签页的模块图失效 →
 * 动态 import 抛「Failed to fetch dynamically imported module」→ 整页 reload 一次拿新模块图。
 * sessionStorage 记录已刷新过：刷新后仍失败则停在错误态，绝不无限循环。
 */
export interface RouterErrorLike {
  message: string;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface LocationLike {
  reload(): void;
}

export const IMPORT_FAILURE_RELOAD_KEY = 'router:chunk-reload';

/** vite/vue 常见的动态导入失败文案（en + 部分浏览器变体） */
const DYNAMIC_IMPORT_FAIL = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

/**
 * @returns true = 触发了一次自愈 reload；false = 不处理（非导入失败 / 已刷新过 / 存储异常）
 */
export function dynamicImportFailureReload(
  error: RouterErrorLike,
  storage: StorageLike,
  location: LocationLike,
): boolean {
  if (!DYNAMIC_IMPORT_FAIL.test(error.message ?? '')) return false;
  let reloaded = false;
  try {
    reloaded = storage.getItem(IMPORT_FAILURE_RELOAD_KEY) != null;
  } catch {
    // 隐私模式/禁用 storage：按「已刷新过」处理，宁可停在错误态也不冒险循环
    return false;
  }
  if (reloaded) return false;
  try {
    storage.setItem(IMPORT_FAILURE_RELOAD_KEY, '1');
  } catch {
    return false;
  }
  location.reload();
  return true;
}
