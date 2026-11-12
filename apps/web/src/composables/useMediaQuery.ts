import { onScopeDispose, ref, type Ref } from 'vue';

/**
 * 响应式媒体查询（工作台布局断点用，PC≥1024px 启用侧栏骨架）。
 * 无 window 环境（测试/极端环境）降级为恒 false。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return matches;
  }
  const mql = window.matchMedia(query);
  matches.value = mql.matches;
  const onChange = (e: MediaQueryListEvent): void => {
    matches.value = e.matches;
  };
  mql.addEventListener('change', onChange);
  onScopeDispose(() => {
    mql.removeEventListener('change', onChange);
  });
  return matches;
}
