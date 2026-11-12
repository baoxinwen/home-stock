/**
 * 生产日期 + 保质期时长 → 过期日期 换算（TDD RED）。
 * 契约：server 只收换算结果 expiryDate（ItemCreateDto 注释）。
 */
import { describe, expect, it } from 'vitest';
import { computeExpiryFromShelfLife } from './expiry-input';

describe('computeExpiryFromShelfLife', () => {
  it('production date + shelf days = expiry date', () => {
    expect(computeExpiryFromShelfLife('2026-01-01', 7)).toBe('2026-01-08');
  });

  it('month and year rollover', () => {
    expect(computeExpiryFromShelfLife('2026-01-31', 1)).toBe('2026-02-01');
    expect(computeExpiryFromShelfLife('2025-12-31', 5)).toBe('2026-01-05');
  });

  it('leap year', () => {
    expect(computeExpiryFromShelfLife('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('invalid or missing inputs → null', () => {
    expect(computeExpiryFromShelfLife(null, 7)).toBeNull();
    expect(computeExpiryFromShelfLife('2026-01-01', null)).toBeNull();
    expect(computeExpiryFromShelfLife('2026-13-01', 7)).toBeNull();
    expect(computeExpiryFromShelfLife('2026-01-01', 0)).toBeNull();
  });
});
