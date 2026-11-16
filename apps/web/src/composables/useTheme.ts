/**
 * 主题组合式（system / light / dark）：
 * - 偏好持久化在 localStorage（THEME_STORAGE_KEY），非法值回退 system
 * - system 跟随 prefers-color-scheme 并监听实时变化
 * - 应用方式：document.documentElement[data-theme='light'|'dark']，
 *   令牌翻转在 styles/main.css 的 :root[data-theme='dark']
 * - main.ts 挂载前调 initTheme() 一次性应用，避免首帧闪烁；
 *   设置页用 useTheme() 做运行时切换。
 */
import { computed, onScopeDispose, ref, watch, watchEffect } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'home-stock-theme';

const VALID_PREFS: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** 读取持久化偏好；无/非法值 → system */
export function readThemePreference(storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY) ?? null;
    return VALID_PREFS.includes(raw as ThemePreference) ? (raw as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

/** system → 跟随系统；light/dark → 强制 */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** 把解析结果写到目标元素的 data-theme */
export function applyTheme(
  pref: ThemePreference,
  target: HTMLElement,
  systemDark: boolean,
): ResolvedTheme {
  const resolved = resolveTheme(pref, systemDark);
  target.dataset.theme = resolved;
  return resolved;
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** main.ts 预挂载一次性应用：不建立监听，避免首帧闪烁 */
export function initTheme(target: HTMLElement = document.documentElement): void {
  applyTheme(readThemePreference(), target, systemPrefersDark());
}

/** 设置页运行时切换：响应式偏好 + 系统实时监听 + 持久化 */
export function useTheme() {
  const preference = ref<ThemePreference>(readThemePreference());
  const systemDark = ref(systemPrefersDark());

  let mq: MediaQueryList | null = null;
  let onChange: ((e: MediaQueryListEvent) => void) | null = null;
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      systemDark.value = mq.matches;
      onChange = (e) => {
        systemDark.value = e.matches;
      };
      mq.addEventListener('change', onChange);
      onScopeDispose(() => {
        mq?.removeEventListener('change', onChange as never);
      });
    }
  } catch {
    /* 环境不支持 matchMedia：systemDark 保持初值 */
  }

  const resolved = computed<ResolvedTheme>(() => resolveTheme(preference.value, systemDark.value));

  watchEffect(() => {
    document.documentElement.dataset.theme = resolved.value;
  });

  // 评审 C-M1：主题翻转时抑制全站过渡——main.css 的 200ms 颜色过渡 + 各组件分散的
  // 150ms 过渡同时开火，整页几十个表面逐一变色出现明显涂抹。注入一次性全量
  // transition:none → 强制 reflow → 双 rAF 后移除，一处实现全站生效
  watch(resolved, () => {
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.appendChild(style);
    void document.body.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => style.remove());
    });
  });

  function setPreference(pref: ThemePreference): void {
    preference.value = pref;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      /* 存储不可用：仅本次会话生效 */
    }
  }

  return { preference, resolved, setPreference };
}
