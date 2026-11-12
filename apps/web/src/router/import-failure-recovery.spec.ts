/**
 * 动态导入失败自愈逻辑单测（I-8）：匹配范围、一次性、storage 异常降级。
 * 语义与分支版 recoverFromChunkLoadError 对齐：整页 reload 一次、sessionStorage 防循环。
 */
import { describe, expect, it } from 'vitest';
import {
  IMPORT_FAILURE_RELOAD_KEY,
  dynamicImportFailureReload,
  type LocationLike,
  type StorageLike,
} from './import-failure-recovery';

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  return { storage, map };
}

function makeLocation(): LocationLike & { reloads: number } {
  const counter = { reloads: 0 };
  return {
    reload: () => {
      counter.reloads += 1;
    },
    get reloads() {
      return counter.reloads;
    },
  };
}

describe('dynamicImportFailureReload（I-8 chunk 加载失败兜底）', () => {
  it('动态导入失败 → reload 一次并写标记', () => {
    const { storage, map } = makeStorage();
    const loc = makeLocation();
    const handled = dynamicImportFailureReload(
      { message: 'TypeError: Failed to fetch dynamically imported module: /assets/stats-abc123.js' },
      storage,
      loc,
    );
    expect(handled).toBe(true);
    expect(loc.reloads).toBe(1);
    expect(map.get(IMPORT_FAILURE_RELOAD_KEY)).toBe('1');
  });

  it('标记已存在（已刷新过）→ 不再刷新，防无限循环', () => {
    const { storage } = makeStorage({ [IMPORT_FAILURE_RELOAD_KEY]: '1' });
    const loc = makeLocation();
    const handled = dynamicImportFailureReload(
      { message: 'Failed to fetch dynamically imported module: x' },
      storage,
      loc,
    );
    expect(handled).toBe(false);
    expect(loc.reloads).toBe(0);
  });

  it('其他错误类型不处理', () => {
    const { storage } = makeStorage();
    const loc = makeLocation();
    expect(
      dynamicImportFailureReload({ message: '404 no match for /items/9' }, storage, loc),
    ).toBe(false);
    expect(loc.reloads).toBe(0);
  });

  it('storage 抛异常（隐私模式）→ 降级为不刷新', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const loc = makeLocation();
    const handled = dynamicImportFailureReload(
      { message: 'Failed to fetch dynamically imported module: x' },
      storage,
      loc,
    );
    expect(handled).toBe(false);
    expect(loc.reloads).toBe(0);
  });

  it('浏览器变体文案（Importing a module script failed）同样命中', () => {
    const { storage } = makeStorage();
    const loc = makeLocation();
    expect(
      dynamicImportFailureReload({ message: 'Importing a module script failed.' }, storage, loc),
    ).toBe(true);
    expect(loc.reloads).toBe(1);
  });
});
