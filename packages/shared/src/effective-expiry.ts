/**
 * 有效过期日计算（规格第 5 节「有效过期日计算规则」）。
 *
 * 规则（按优先级）：
 * 1. opened=1 且 open_shelf_days 非空（>0）且 opened_at 合法 → opened_at + open_shelf_days
 * 2. 否则若 expiry_date 非空（合法） → expiry_date
 * 3. 否则 → null（无过期概念，长期存储品）
 *
 * 所有日期均为本地日期字符串（YYYY-MM-DD），不做时区换算。
 */

/** 输入字段与 items 表对应（opened: 0/1）。 */
export interface EffectiveExpiryInput {
  /** 是否已开封：1 = 已开封（truthy），0/null/undefined = 未开封 */
  opened?: number | boolean | null;
  /** 开封日期，ISO 日期字符串（YYYY-MM-DD），可空 */
  openedAt?: string | null;
  /** 开封后保质天数（可空）；≤0 / 非法值视为未设置 */
  openShelfDays?: number | null;
  /** 过期日期，ISO 日期字符串（YYYY-MM-DD），可空（长期存储品为空） */
  expiryDate?: string | null;
}

/** 校验 `YYYY-MM-DD` 格式且为真实存在的日历日期（拒绝 2026-02-30 这类）。 */
export function isValidISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 在 ISO 日期字符串上加 n 天（n 为整数，负数即减），返回 ISO 日期字符串。非法 base 抛错。 */
export function addDaysISO(base: string, n: number): string {
  if (!isValidISODate(base)) {
    throw new Error(`addDaysISO: invalid base date "${base}"`);
  }
  if (!Number.isFinite(n)) {
    throw new Error(`addDaysISO: invalid day offset "${n}"`);
  }
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.trunc(n));
  return d.toISOString().slice(0, 10);
}

/**
 * 计算物品的有效过期日。
 *
 * 边界约定：
 * - 输入为 null/undefined/空对象 → null
 * - opened 为 truthy 但 openedAt 缺失或非法 → 规则 1 不可用，回退规则 2（expiryDate）
 * - openShelfDays ≤ 0 / NaN / Infinity / 非法 → 视为未设置，回退规则 2
 * - 非法日期串一律视为该字段缺失，绝不抛异常、绝不返回非法字符串
 * - 非整数 openShelfDays 按天数向下取整（如 1.5 → 1 天）
 *
 * @returns ISO 日期字符串（YYYY-MM-DD）或 null（无过期概念）
 */
export function computeEffectiveExpiry(input: EffectiveExpiryInput | null | undefined): string | null {
  if (input == null || typeof input !== 'object') return null;

  const isOpened = Boolean(input.opened);
  const openShelfDays = input.openShelfDays;
  const shelfDaysUsable =
    typeof openShelfDays === 'number' && Number.isFinite(openShelfDays) && openShelfDays > 0;
  const openedAtUsable = isValidISODate(input.openedAt);

  // 规则 1：开封后按 开封日期 + 开封保质天数
  if (isOpened && shelfDaysUsable && openedAtUsable) {
    return addDaysISO(input.openedAt as string, Math.trunc(openShelfDays as number));
  }

  // 规则 2 / 3：回退到 expiry_date，非法或缺失 → null
  return isValidISODate(input.expiryDate) ? (input.expiryDate as string) : null;
}

/**
 * 有效过期日已过的天数（恢复面板 I-4 复用）：
 * 早于 today → 天数（≥1）；今天到期或未来 → 0；null/非法 → 0。
 * 口径与 computeEffectiveExpiry/expiringWithin 一致（UTC 日期差）。
 */
export function overdueDays(effectiveExpiryDate: string | null | undefined, today: string): number {
  if (!isValidISODate(effectiveExpiryDate)) return 0;
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${effectiveExpiryDate}T00:00:00Z`)) / 86400000,
  );
  if (!Number.isFinite(days) || days < 0) return 0;
  return days;
}
