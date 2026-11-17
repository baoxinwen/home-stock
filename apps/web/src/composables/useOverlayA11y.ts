/**
 * 弹层无障碍焦点管理（评审 A-M1/A-M2，APG Dialog 模式的项目内收敛实现）：
 * - 打开：记录触发元素 → 背景置 inert（#app；Teleport 到 body 的面板自身不受影响）→ 移焦进面板
 * - Escape：监听在面板元素上——嵌套时内层面板先于外层抽屉（document/window）响应并 stopPropagation
 * - 关闭：解除 inert → 焦点还原触发点；触发点已随行卸载时回退 fallbackFocus 选择器
 *
 * 两种宿主形态：
 * - v-if 整组件弹层（RestoreChoicePanel/ItemDrawer）：省略 open，挂载即激活、卸载即还原
 * - 组件内 v-if 面板（DetailContent 双面板/SettingsView/ItemFormView）：传 open watch 开合
 */
import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

export interface OverlayA11yOptions {
  /** 弹层面板根（role="dialog" 容器，需 tabindex="-1"） */
  panel: Ref<HTMLElement | null>;
  close: () => void;
  /** 打开态；省略视为随宿主挂载即打开 */
  open?: Ref<boolean>;
  /** 触发点已不在 DOM 时（行被移除/页面切换）的焦点回退选择器 */
  fallbackFocus?: string;
}

/**
 * 背景 inert 引用计数：抽屉开着时再开内层面板（归档/删除确认），
 * 关闭内层不得解除抽屉的 inert——只有最后一层关闭才解除。
 * 前提：面板自身不在 #app 子树内（ Teleport to body），否则会被自家 inert 误伤。
 */
let inertDepth = 0;

function acquireInert(): void {
  inertDepth += 1;
  const app = document.getElementById('app');
  if (app) app.inert = true;
}

function releaseInert(): void {
  inertDepth = Math.max(0, inertDepth - 1);
  if (inertDepth === 0) {
    const app = document.getElementById('app');
    if (app) app.inert = false;
  }
}

export function useOverlayA11y(options: OverlayA11yOptions): void {
  let trigger: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;
  /** 只还原自己激活过的层（open 初始 false 的实例在 immediate 首跑不得触碰引用计数） */
  let isActive = false;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Tab 环绕捕获：末尾 Tab 回第一个、首部 Shift+Tab 回最后一个——
   *  否则 Chromium 会让焦点落到 body 死区（背景已 inert 时无落点），
   *  后续 Escape 将不经过面板监听（评审 A-M1 实测复现） */
  function trapTab(e: KeyboardEvent): void {
    const panel = panelEl;
    if (!panel) return;
    const list = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el === document.activeElement || el.offsetParent !== null,
    );
    if (list.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (!panel.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // 内层面板拦截，外层（ItemDrawer 的 window 监听）不再响应
      e.stopPropagation();
      options.close();
      return;
    }
    if (e.key === 'Tab') trapTab(e);
  }

  async function activate(): Promise<void> {
    isActive = true;
    trigger = document.activeElement as HTMLElement | null;
    acquireInert();
    await nextTick();
    panelEl = options.panel.value;
    if (panelEl) {
      panelEl.addEventListener('keydown', onKeydown);
      panelEl.focus();
    }
  }

  function deactivate(): void {
    isActive = false;
    if (panelEl) {
      panelEl.removeEventListener('keydown', onKeydown);
      panelEl = null;
    }
    releaseInert();
    if (trigger && trigger.isConnected) {
      trigger.focus();
    } else if (options.fallbackFocus) {
      document.querySelector<HTMLElement>(options.fallbackFocus)?.focus();
    }
    trigger = null;
  }

  if (options.open) {
    watch(
      options.open,
      (open) => {
        if (open && !isActive) void activate();
        else if (!open && isActive) deactivate();
      },
      { immediate: true },
    );
  } else {
    void activate();
  }

  onBeforeUnmount(() => {
    if (isActive) deactivate();
  });
}
