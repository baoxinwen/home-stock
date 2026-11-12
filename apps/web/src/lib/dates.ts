/** 本地日期展示工具：ISO（YYYY-MM-DD）↔ 中文显示，不做时区换算。 */

/** 本地今天（可传基准日便于测试/派生），YYYY-MM-DD。 */
export function todayISO(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function isValidISO(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** ISO 日期 → 「YYYY年M月D日」；空/非法 → 「—」。 */
export function formatDateCN(s: string | null | undefined): string {
  if (!isValidISO(s)) return '—';
  const [y, m, d] = (s as string).split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/**
 * ISO 日期 → 相对时间（通知时间线用，B1）：今天/昨天/N 天前；
 * 超过 7 天退化为「M月D日」，跨年再加年份。空/非法 → 「—」。
 * 口径与 expiringWithin 一致（UTC 日期差）。
 */
export function relativeDate(s: string | null | undefined, today: string): string {
  if (!isValidISO(s)) return '—';
  const left = Math.round(
    (Date.parse(`${s}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );
  if (!Number.isFinite(left)) return '—';
  if (left === 0) return '今天';
  if (left === -1) return '昨天';
  if (left < 0 && left >= -7) return `${-left} 天前`;
  const [, m, d] = (s as string).split('-');
  const year = (s as string).slice(0, 4);
  const md = `${Number(m)}月${Number(d)}日`;
  return year === today.slice(0, 4) ? md : `${year}年${md}`;
}
