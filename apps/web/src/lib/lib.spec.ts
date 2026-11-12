/**
 * 徽章映射与防抖 composable（TDD RED）。
 */
import { describe, expect, it, vi } from 'vitest';
import { archiveBadgeFor, badgeFor } from './badges';
import { useDebounced } from './debounce';
import { formatDateCN, relativeDate, todayISO } from './dates';
import { needsExpiryDate } from './needs-expiry';

describe('badgeFor', () => {
  it('maps expiryStatus to minimalist palette badges', () => {
    expect(badgeFor('expired')).toEqual({ text: '已过期', tone: 'red' });
    expect(badgeFor('expiring')).toEqual({ text: '临期', tone: 'yellow' });
    expect(badgeFor('ok')).toEqual({ text: '在库', tone: 'green' });
    expect(badgeFor('none')).toEqual({ text: '长期', tone: 'blue' });
  });

  it('opened item shows opened badge (Pale Blue)', () => {
    expect(badgeFor('ok', 1)).toEqual({ text: '已开封', tone: 'blue' });
    expect(badgeFor('none', 1)).toEqual({ text: '已开封', tone: 'blue' });
    // expired/expiring 优先于开封角标
    expect(badgeFor('expired', 1)).toEqual({ text: '已过期', tone: 'red' });
  });

  it('maps archive reasons', () => {
    expect(archiveBadgeFor('used_up')).toEqual({ text: '用完', tone: 'green' });
    expect(archiveBadgeFor('expired_discarded')).toEqual({ text: '过期丢弃', tone: 'red' });
  });
});

describe('useDebounced', () => {
  it('debounces by delay ms', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const d = useDebounced((v: string) => seen.push(v), 300);
    d('a');
    d('ab');
    d('abc');
    vi.advanceTimersByTime(299);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['abc']);
    vi.useRealTimers();
  });

  it('cancel() 取消尚未触发的回调（M18）', () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const d = useDebounced((v: string) => seen.push(v), 300);
      d('a');
      (d as unknown as { cancel(): void }).cancel();
      vi.advanceTimersByTime(300);
      expect(seen).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dates', () => {
  it('todayISO returns YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formatDateCN renders CN format and dash for empty', () => {
    expect(formatDateCN('2026-01-09')).toBe('2026年1月9日');
    expect(formatDateCN(null)).toBe('—');
  });
});

describe('relativeDate（通知时间线 B1）', () => {
  it('今天/昨天/N 天前/超一周退化 M月D日/跨年带年份', () => {
    expect(relativeDate('2026-02-15', '2026-02-15')).toBe('今天');
    expect(relativeDate('2026-02-14', '2026-02-15')).toBe('昨天');
    expect(relativeDate('2026-02-12', '2026-02-15')).toBe('3 天前');
    expect(relativeDate('2026-02-01', '2026-02-15')).toBe('2月1日');
    expect(relativeDate('2025-12-30', '2026-02-15')).toBe('2025年12月30日');
    expect(relativeDate(null, '2026-02-15')).toBe('—');
  });
});

describe('needsExpiryDate（M5.3 待补过期日派生，仅 shopping 来源；D-3 修订：窗口已移除）', () => {
  it('shopping 来源 + 无过期日 → true（不再受创建时间窗口限制，欠账常驻）', () => {
    expect(
      needsExpiryDate({ source: 'shopping', expiryDate: null, effectiveExpiryDate: null }),
    ).toBe(true);
    // 远早于任何窗口的历史转库存物品同样提示
    expect(
      needsExpiryDate({ source: 'shopping', expiryDate: null, effectiveExpiryDate: null }),
    ).toBe(true);
  });

  it('手动录入（source=manual）无过期日不提示（M3.4 长期存储品）', () => {
    expect(needsExpiryDate({ source: 'manual', expiryDate: null, effectiveExpiryDate: null })).toBe(
      false,
    );
  });

  it('有过期日 / 有效过期日 → false', () => {
    expect(
      needsExpiryDate({ source: 'shopping', expiryDate: '2030-01-01', effectiveExpiryDate: '2030-01-01' }),
    ).toBe(false);
  });
});
