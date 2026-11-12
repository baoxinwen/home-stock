/**
 * useMediaQuery 单测：初始值取自 matchMedia、change 事件同步、卸载时移除监听。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { useMediaQuery } from './useMediaQuery';

type ChangeHandler = (e: { matches: boolean }) => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<ChangeHandler>();
  const mql = {
    matches: initial,
    addEventListener: vi.fn((_type: string, cb: ChangeHandler) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: string, cb: ChangeHandler) => listeners.delete(cb)),
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
    removeEventListener: mql.removeEventListener,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('初始值取自 matchMedia().matches', () => {
    const stub = stubMatchMedia(true);
    const scope = effectScope();
    let matches: boolean | undefined;
    scope.run(() => {
      matches = useMediaQuery('(min-width: 1024px)').value;
    });
    expect(matches).toBe(true);
    expect(stub.removeEventListener).not.toHaveBeenCalled();
    scope.stop();
    expect(stub.removeEventListener).toHaveBeenCalled();
  });

  it('初始不匹配时为 false', () => {
    stubMatchMedia(false);
    const scope = effectScope();
    let matches: boolean | undefined;
    scope.run(() => {
      matches = useMediaQuery('(min-width: 1024px)').value;
    });
    expect(matches).toBe(false);
    scope.stop();
  });

  it('媒体状态变化时响应式更新', () => {
    const stub = stubMatchMedia(false);
    const scope = effectScope();
    // 持有 ref 本身断言（.value 快照不随响应式更新）
    let matchesRef: ReturnType<typeof useMediaQuery> | undefined;
    scope.run(() => {
      matchesRef = useMediaQuery('(min-width: 1024px)');
    });
    expect(matchesRef?.value).toBe(false);
    stub.fire(true);
    expect(matchesRef?.value).toBe(true);
    stub.fire(false);
    expect(matchesRef?.value).toBe(false);
    scope.stop();
  });
});
