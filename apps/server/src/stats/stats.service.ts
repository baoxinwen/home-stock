/**
 * 浪费统计（规格 M10.1/M10.2）。
 *
 * 口径：
 * - 仅 status=archived 且 archived_reason='expired_discarded'；'used_up' 不计入浪费
 * - 月份归属看 archived_at（不是 updated_at）；archived_at 为空不计入任何月
 * - 件数 = 归档条目数；金额 = Σ(price×quantity)，未填价格记 0 但仍计件数
 * - 金额以「分」汇总：分桶先四舍五入到分，总计 = 各桶之和
 *   （保证 ΣbyCategory.amount === totalAmount，不会出现总计 0.36 / 分桶合计 0.37）
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  API_ERROR_CODES,
  WASTE_GROUP_BYS,
  type WasteBucketDto,
  type WasteGroupBy,
  type WasteStatsDto,
} from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { categories, items } from '../db/schema';
import { ApiException } from '../common/api.exception';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const UNCATEGORIZED_NAME = '未分类';
/** 类别分桶排序兜底：categoryId 升序时把 null 放最后 */
const NULL_CATEGORY_ORDER = Number.MAX_SAFE_INTEGER;

interface RawBucket {
  categoryId: number | null;
  categoryName: string;
  count: number;
  /** 桶内原始金额（未取整），末尾统一四舍五入到分 */
  amount: number;
}

@Injectable()
export class StatsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /**
   * @param periodRaw  YYYY-MM，缺省/空串 = 当月
   * @param groupByRaw category（默认）| month；数组等非法输入一律 400
   */
  async waste(periodRaw?: unknown, groupByRaw?: unknown): Promise<WasteStatsDto> {
    const period = normalizePeriod(periodRaw);
    const groupBy = normalizeGroupBy(groupByRaw);

    const rows = this.db
      .select({
        categoryId: items.categoryId,
        categoryName: categories.name,
        price: items.price,
        quantity: items.quantity,
      })
      .from(items)
      .leftJoin(categories, eq(items.categoryId, categories.id))
      .where(
        and(
          eq(items.status, 'archived'),
          eq(items.archivedReason, 'expired_discarded'),
          sql`substr(${items.archivedAt}, 1, 7) = ${period}`,
        ),
      )
      .all();

    const buckets = new Map<string, RawBucket>();
    for (const row of rows) {
      const amount = (row.price ?? 0) * (row.quantity ?? 0);
      const key = row.categoryId == null ? 'uncategorized' : String(row.categoryId);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.amount += amount;
      } else {
        buckets.set(key, {
          categoryId: row.categoryId ?? null,
          categoryName: row.categoryName ?? UNCATEGORIZED_NAME,
          count: 1,
          amount,
        });
      }
    }

    // 分桶各四舍五入到「分」，总计 = 分桶之和（保证 ΣbyCategory.amount 与 totalAmount 自洽）
    const roundedBuckets = [...buckets.values()]
      .map((b) => ({ ...b, amountCents: toCents(b.amount) }))
      .sort(
        (a, b) =>
          b.amountCents - a.amountCents ||
          b.count - a.count ||
          (a.categoryId ?? NULL_CATEGORY_ORDER) - (b.categoryId ?? NULL_CATEGORY_ORDER),
      );

    const byCategory: WasteBucketDto[] = roundedBuckets.map((b) => ({
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      count: b.count,
      amount: b.amountCents / 100,
    }));

    const totalCents = roundedBuckets.reduce((sum, b) => sum + b.amountCents, 0);
    const totalAmount = totalCents / 100;
    const stats: WasteStatsDto = {
      period,
      totalCount: rows.length,
      totalAmount,
      byCategory,
    };
    // groupBy=month：period 为单月，故 byMonth 只含该月一个桶（空月份也给零值桶）
    if (groupBy === 'month') {
      stats.byMonth = [{ month: period, count: rows.length, amount: totalAmount }];
    }
    return stats;
  }
}

function normalizePeriod(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return currentMonth();
  if (typeof raw !== 'string' || !PERIOD_PATTERN.test(raw)) {
    throw new ApiException(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      `period 非法：${String(raw)}，应为 YYYY-MM`,
    );
  }
  return raw;
}

function normalizeGroupBy(raw: unknown): WasteGroupBy {
  if (raw === undefined || raw === null || raw === '') return 'category';
  if (typeof raw !== 'string' || !(WASTE_GROUP_BYS as readonly string[]).includes(raw)) {
    throw new ApiException(
      400,
      API_ERROR_CODES.VALIDATION_ERROR,
      `groupBy 非法：${String(raw)}，可选 category|month`,
    );
  }
  return raw as WasteGroupBy;
}

/** 本地当月 YYYY-MM（与 items 的 archived_at 本地时间口径一致） */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 金额转「分」：四舍五入到分（+EPSILON 抵消 0.0165 这类二进制表示偏小） */
function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}
