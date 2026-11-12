import { describe, it, expect } from 'vitest';
import { computeEffectiveExpiry, addDaysISO, isValidISODate, overdueDays } from './effective-expiry';

describe('computeEffectiveExpiry', () => {
  // ── 规格第 5 节规则 1：opened=1 且 openShelfDays 非空 → openedAt + openShelfDays ──
  it('rule 1: opened with openShelfDays → openedAt + openShelfDays', () => {
    expect(
      computeEffectiveExpiry({
        opened: 1,
        openedAt: '2026-11-01',
        openShelfDays: 3,
        expiryDate: '2026-12-31',
      }),
    ).toBe('2026-11-04');
  });

  it('rule 1 wins even if openedAt + days exceeds expiryDate', () => {
    expect(
      computeEffectiveExpiry({
        opened: 1,
        openedAt: '2026-06-01',
        openShelfDays: 10,
        expiryDate: '2026-06-05',
      }),
    ).toBe('2026-06-11');
  });

  it('rule 1 handles month rollover', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-01-30', openShelfDays: 5, expiryDate: null }),
    ).toBe('2026-02-04');
  });

  it('rule 1 handles leap-year rollover', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2028-02-27', openShelfDays: 2, expiryDate: null }),
    ).toBe('2028-02-29');
  });

  // ── 规格规则 2：未开封 → expiryDate ──
  it('rule 2: not opened → expiryDate as-is', () => {
    expect(
      computeEffectiveExpiry({
        opened: 0,
        openedAt: null,
        openShelfDays: 3,
        expiryDate: '2026-12-31',
      }),
    ).toBe('2026-12-31');
  });

  it('opened=0 ignores openedAt/openShelfDays', () => {
    expect(
      computeEffectiveExpiry({ opened: 0, openedAt: '2026-01-01', openShelfDays: 3, expiryDate: '2026-05-01' }),
    ).toBe('2026-05-01');
  });

  // ── 规格规则 3：均无 → null（长期存储品） ──
  it('rule 3: no expiryDate and not opened → null (long-term storage)', () => {
    expect(
      computeEffectiveExpiry({ opened: 0, openedAt: null, openShelfDays: null, expiryDate: null }),
    ).toBeNull();
  });

  // ── 空输入 / null 字段 ──
  it('null input → null', () => {
    expect(computeEffectiveExpiry(null)).toBeNull();
  });

  it('undefined input → null', () => {
    expect(computeEffectiveExpiry(undefined)).toBeNull();
  });

  it('empty object → null', () => {
    expect(computeEffectiveExpiry({})).toBeNull();
  });

  // ── opened=1 但 openedAt 缺失 → 规则 1 无法计算，回退规则 2 ──
  it('opened=1 with missing openedAt falls back to expiryDate', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: null, openShelfDays: 3, expiryDate: '2026-08-01' }),
    ).toBe('2026-08-01');
  });

  it('opened=1 with missing openedAt and no expiryDate → null', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: null, openShelfDays: 3, expiryDate: null }),
    ).toBeNull();
  });

  // ── openShelfDays 极值 ──
  it('openShelfDays = 0 → invalid, falls back to expiryDate', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-01-01', openShelfDays: 0, expiryDate: '2026-03-01' }),
    ).toBe('2026-03-01');
  });

  it('openShelfDays negative → invalid, falls back to expiryDate', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-01-01', openShelfDays: -5, expiryDate: '2026-03-01' }),
    ).toBe('2026-03-01');
  });

  it('openShelfDays huge (36500) is honored', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-01-01', openShelfDays: 36500, expiryDate: null }),
    ).toBe('2125-12-08');
  });

  it('openShelfDays non-integer (1.5) floors to 1 day', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-01-01', openShelfDays: 1.5, expiryDate: null }),
    ).toBe('2026-01-02');
  });

  it('openShelfDays NaN → invalid, falls back to expiryDate', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-01-01', openShelfDays: NaN, expiryDate: '2026-04-01' }),
    ).toBe('2026-04-01');
  });

  // ── 非法日期串 ──
  it('invalid openedAt → rule 1 unusable, falls back to expiryDate', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: 'not-a-date', openShelfDays: 3, expiryDate: '2026-09-01' }),
    ).toBe('2026-09-01');
  });

  it('invalid openedAt and no expiryDate → null', () => {
    expect(
      computeEffectiveExpiry({ opened: 1, openedAt: '2026-13-40', openShelfDays: 3, expiryDate: null }),
    ).toBeNull();
  });

  it('invalid expiryDate on unopened item → null', () => {
    expect(
      computeEffectiveExpiry({ opened: 0, openedAt: null, openShelfDays: null, expiryDate: '2026-02-31' }),
    ).toBeNull();
  });

  it('malformed expiryDate string → null (no exception)', () => {
    expect(
      computeEffectiveExpiry({ opened: 0, openedAt: null, openShelfDays: null, expiryDate: 'garbage' }),
    ).toBeNull();
  });
});

describe('addDaysISO', () => {
  it('adds days across month boundary', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('zero days returns same date', () => {
    expect(addDaysISO('2026-06-15', 0)).toBe('2026-06-15');
  });

  it('negative days subtracts', () => {
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('invalid base date throws', () => {
    expect(() => addDaysISO('nope', 1)).toThrow();
  });
});

describe('isValidISODate', () => {
  it('accepts a valid date', () => {
    expect(isValidISODate('2026-11-06')).toBe(true);
  });

  it('rejects impossible calendar date (2026-02-30)', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
  });

  it('rejects wrong format (ISO datetime)', () => {
    expect(isValidISODate('2026-11-06T10:00:00Z')).toBe(false);
  });

  it('rejects non-string', () => {
    expect(isValidISODate(12345 as never)).toBe(false);
  });
});

describe('overdueDays（I-4 恢复面板复用）', () => {
  it('有效过期日早于今天 → 已过期天数；今天到期 → 0；未来 → 0；null/非法 → 0', () => {
    expect(overdueDays('2026-11-05', '2026-11-07')).toBe(2);
    expect(overdueDays('2026-11-07', '2026-11-07')).toBe(0);
    expect(overdueDays('2026-11-08', '2026-11-07')).toBe(0);
    expect(overdueDays(null, '2026-11-07')).toBe(0);
    expect(overdueDays('not-a-date', '2026-11-07')).toBe(0);
  });
});
