/**
 * 浪费统计页展示用纯函数（无副作用，便于单测）：
 * 月份字符串（YYYY-MM）计算、中文月份标签、金额两位小数、横向条比例，
 * 以及统计仪表盘的客户端聚合（库存总览/浪费趋势/临期筛选/浪费vs用完）。
 */
import type { ItemDto } from '@home-stock/shared';

/** 本地当月，YYYY-MM。 */
export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 月份平移（delta 可负），跨年安全。 */
export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM → 「YYYY年M月」。 */
export function formatPeriodCN(period: string): string {
  const [year, month] = period.split('-');
  return `${year}年${Number(month)}月`;
}

/** 金额两位小数（非法/非有限值按 0）。 */
export function formatAmount(amount: number): string {
  return (Number.isFinite(amount) ? amount : 0).toFixed(2);
}

/** 横向条宽度百分比：最大值为 100%，非零最小值 2% 保证可见。 */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

// ---------- 统计仪表盘聚合（口径与 server stats 对齐：金额两位小数、仅过期丢弃计浪费） ----------

/** 金额求和并四舍五入到两位小数（与 server「先求和再取整到分」口径一致） */
function sumAmount(rows: ItemDto[]): number {
  const total = rows.reduce((sum, it) => sum + (it.price ?? 0) * (it.quantity ?? 0), 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

export interface StockOverviewBucket {
  categoryId: number | null;
  count: number;
  value: number;
}

export interface StockOverview {
  count: number;
  value: number;
  byCategory: StockOverviewBucket[];
}

/** 库存总览：件数、总价值（Σprice×quantity，未填价格记 0）、按类别分桶（价值降序）。 */
export function stockOverview(items: ItemDto[]): StockOverview {
  const buckets = new Map<number | null, StockOverviewBucket>();
  for (const it of items) {
    const key = it.categoryId ?? null;
    const bucket = buckets.get(key) ?? { categoryId: key, count: 0, value: 0 };
    bucket.count += 1;
    bucket.value += (it.price ?? 0) * (it.quantity ?? 0);
    buckets.set(key, bucket);
  }
  const byCategory = [...buckets.values()]
    .map((b) => ({ ...b, value: Math.round((b.value + Number.EPSILON) * 100) / 100 }))
    .sort((a, b) => b.value - a.value || b.count - a.count);
  return { count: items.length, value: sumAmount(items), byCategory };
}

export interface WasteTrendBucket {
  month: string;
  count: number;
  amount: number;
}

/** 近 months 个月浪费趋势（截至 endPeriod，零值填充；仅 status=archived 且 expired_discarded）。 */
export function wasteTrend(archived: ItemDto[], months: number, endPeriod: string): WasteTrendBucket[] {
  const window: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) window.push(shiftPeriod(endPeriod, -i));
  const buckets = new Map<string, WasteTrendBucket>(window.map((m) => [m, { month: m, count: 0, amount: 0 }]));
  for (const it of archived) {
    if (it.status !== 'archived' || it.archivedReason !== 'expired_discarded') continue;
    const month = (it.archivedAt ?? '').slice(0, 7);
    const bucket = buckets.get(month);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += (it.price ?? 0) * (it.quantity ?? 0);
  }
  return window.map((m) => {
    const b = buckets.get(m)!;
    return { ...b, amount: Math.round((b.amount + Number.EPSILON) * 100) / 100 };
  });
}

export interface ExpiringEntry {
  item: ItemDto;
  daysLeft: number;
}

/** 未来 days 天内到期的在库物品（0≤剩余≤days，按剩余天数升序；无有效期与已过期不含）。 */
export function expiringWithin(items: ItemDto[], today: string, days: number): ExpiringEntry[] {
  const list: ExpiringEntry[] = [];
  for (const it of items) {
    const expiry = it.effectiveExpiryDate;
    if (!expiry) continue;
    const left = Math.round(
      (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
    );
    if (!Number.isFinite(left) || left < 0 || left > days) continue;
    list.push({ item: it, daysLeft: left });
  }
  return list.sort((a, b) => a.daysLeft - b.daysLeft || a.item.id - b.item.id);
}

export interface UsageSplit {
  wasted: { count: number; amount: number };
  usedUp: { count: number; amount: number };
}

/** 指定月份的 浪费（expired_discarded）vs 用完（used_up）拆分，其他原因/月份忽略。 */
export function usageSplit(archived: ItemDto[], period: string): UsageSplit {
  const rows = archived.filter((it) => (it.archivedAt ?? '').slice(0, 7) === period);
  const wastedRows = rows.filter((it) => it.archivedReason === 'expired_discarded');
  const usedUpRows = rows.filter((it) => it.archivedReason === 'used_up');
  return {
    wasted: { count: wastedRows.length, amount: sumAmount(wastedRows) },
    usedUp: { count: usedUpRows.length, amount: sumAmount(usedUpRows) },
  };
}

// ---------- 库存健康与入库节奏（统计页 P0 扩充，纯客户端口径） ----------

export interface FreshnessBuckets {
  expired: number;
  d7: number;
  d30: number;
  d90: number;
  over90: number;
  undated: number;
}

/** 剩余保质期分桶（口径与 expiringWithin 一致：UTC 日期差）。日期差含今天（0 天 = 今天到期）。 */
export function freshnessBuckets(items: ItemDto[], today: string): FreshnessBuckets {
  const buckets: FreshnessBuckets = { expired: 0, d7: 0, d30: 0, d90: 0, over90: 0, undated: 0 };
  for (const it of items) {
    const expiry = it.effectiveExpiryDate;
    if (!expiry) {
      buckets.undated += 1;
      continue;
    }
    const left = Math.round(
      (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
    );
    if (!Number.isFinite(left) || left < 0) buckets.expired += 1;
    else if (left <= 7) buckets.d7 += 1;
    else if (left <= 30) buckets.d30 += 1;
    else if (left <= 90) buckets.d90 += 1;
    else buckets.over90 += 1;
  }
  return buckets;
}

export interface StockStatusSplit {
  expired: number;
  expiring: number;
  opened: number;
  ok: number;
}

/**
 * 库存状态四段（互斥，供环形图）：按紧急度归组——
 * expired > expiring > opened > ok。开封且临期的物品计入临期（更紧急）。
 * 判定用 server 下发的 expiryStatus 字段，不重算日期（口径与服务端一致）。
 */
export function stockStatusSplit(items: ItemDto[]): StockStatusSplit {
  const split: StockStatusSplit = { expired: 0, expiring: 0, opened: 0, ok: 0 };
  for (const it of items) {
    if (it.expiryStatus === 'expired') split.expired += 1;
    else if (it.expiryStatus === 'expiring') split.expiring += 1;
    else if (it.opened === 1) split.opened += 1;
    else split.ok += 1;
  }
  return split;
}

/**
 * 近 months 个月入库节奏（截至 endPeriod，零值填充）：按 purchaseDate 月份分桶，
 * 金额 = Σprice×quantity（与浪费趋势同口径）。未填购买日期的物品不计入。
 * items 传在库+归档全量（归档物品也曾入库）。
 */
export function purchaseTrend(items: ItemDto[], months: number, endPeriod: string): WasteTrendBucket[] {
  const window: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) window.push(shiftPeriod(endPeriod, -i));
  const buckets = new Map<string, WasteTrendBucket>(window.map((m) => [m, { month: m, count: 0, amount: 0 }]));
  for (const it of items) {
    const month = (it.purchaseDate ?? '').slice(0, 7);
    const bucket = buckets.get(month);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += (it.price ?? 0) * (it.quantity ?? 0);
  }
  return window.map((m) => {
    const b = buckets.get(m)!;
    return { ...b, amount: Math.round((b.amount + Number.EPSILON) * 100) / 100 };
  });
}

export type MonthDelta = { kind: 'up' | 'down' | 'new' | 'flat'; percent: number | null };

/** 月度环比：up/down 带百分比；上月为 0 且本月 >0 视为 new；两者皆 0 视为 flat。 */
export function monthOverMonth(current: number, previous: number): MonthDelta {
  if (previous <= 0 && current <= 0) return { kind: 'flat', percent: null };
  if (previous <= 0) return { kind: 'new', percent: null };
  if (current === 0) return { kind: 'down', percent: 100 };
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { kind: 'flat', percent: 0 };
  return { kind: percent > 0 ? 'up' : 'down', percent };
}

// ---------- 价值 Top 排行（2026-11-11 统计页图表扩充） ----------

export interface TopValueEntry {
  item: ItemDto;
  /** price×quantity，两位小数，恒 > 0 */
  value: number;
}

/** 在库物品按占用价值降序前 limit 名；零价值（未填价格/数量 0）不入榜。 */
export function topValueItems(items: ItemDto[], limit: number): TopValueEntry[] {
  return items
    .map((it) => ({
      item: it,
      value: Math.round(((it.price ?? 0) * (it.quantity ?? 0) + Number.EPSILON) * 100) / 100,
    }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || a.item.id - b.item.id)
    .slice(0, limit);
}
