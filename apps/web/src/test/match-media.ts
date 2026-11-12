/**
 * 测试专用：window.matchMedia 桩。
 * happy-dom 的默认实现恒返回 matches=true，无法表达移动端/桌面端分派，需按用例指定初值。
 * 记录监听注册/移除次数，供「卸载时移除断点监听」类断言使用。
 */

interface FakeMediaQueryListEvent {
  matches: boolean;
}

export interface MatchMediaStub {
  /** 当前注册的 change 监听数（注册 1 个） */
  added: number;
  /** 已移除的 change 监听数 */
  removed: number;
  /** 触发一次断点变化 */
  fire(matches: boolean): void;
  /** 恢复原始 window.matchMedia */
  restore(): void;
}

export function stubMatchMedia(initialMatches: boolean): MatchMediaStub {
  const original = window.matchMedia;
  const listeners = new Set<(e: FakeMediaQueryListEvent) => void>();
  const mql = {
    matches: initialMatches,
    addEventListener: (_type: string, fn: (e: FakeMediaQueryListEvent) => void) => {
      listeners.add(fn);
      stub.added += 1;
    },
    removeEventListener: (_type: string, fn: (e: FakeMediaQueryListEvent) => void) => {
      listeners.delete(fn);
      stub.removed += 1;
    },
  };
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  const stub: MatchMediaStub = {
    added: 0,
    removed: 0,
    fire(matches: boolean) {
      for (const fn of listeners) fn({ matches });
    },
    restore() {
      window.matchMedia = original;
    },
  };
  return stub;
}

/** 临时删除 window.matchMedia（模拟不可用环境），用例结束后必须恢复。 */
export function withoutMatchMedia(run: () => void): void {
  const original = window.matchMedia;
  delete (window as { matchMedia?: unknown }).matchMedia;
  try {
    run();
  } finally {
    window.matchMedia = original;
  }
}
