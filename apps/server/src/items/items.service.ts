import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, like } from 'drizzle-orm';
import { computeEffectiveExpiry, isValidISODate } from '@home-stock/shared';
import { API_ERROR_CODES, type ArchiveReason, type ExpiryStatus, type ItemCreateDto, type ItemDto, type ItemHistoryDto, type ItemSource, type ItemUpdateDto } from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { categories, items } from '../db/schema';
import { ApiException } from '../common/api.exception';
import { SettingsService } from '../settings/settings.service';
import { localTimestamp } from '../reminders/clock';

type ItemRow = typeof items.$inferSelect;

/**
 * M1/M8：name 校验 + trim 归一（与 categories/shopping 的 normalizeName 一致）。
 * 必须为字符串（null/数字 → 400 VALIDATION_ERROR，不静默 String() 转换），
 * 落库用 trim 值，避免带空格的“同名”条目混进搜索/历史。
 */
function normalizeItemName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > 100) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'name 必填且不超过 100 字符');
  }
  return name;
}

@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
  ) {}

  // ---------- 查询 ----------

  async list(q: string, category: number | null, status: 'active' | 'archived'): Promise<ItemDto[]> {
    const conds = [eq(items.status, status)];
    if (q) conds.push(like(items.name, `%${q}%`));
    if (category !== null) conds.push(eq(items.categoryId, category));
    const rows = this.db.select().from(items).where(and(...conds)).orderBy(asc(items.id)).all();
    const defaultRemindDays = await this.defaultRemindDays();
    return rows.map((r) => this.toDto(r, defaultRemindDays));
  }

  async history(q: string): Promise<ItemHistoryDto[]> {
    const conds = [];
    if (q) conds.push(like(items.name, `%${q}%`));
    const rows = this.db
      .select()
      .from(items)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(items.id))
      .all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.categoryId ?? null,
      unit: r.unit ?? null,
      price: r.price ?? null,
      expiryDate: r.expiryDate ?? null,
      openShelfDays: r.openShelfDays ?? null,
      remindDays: r.remindDays ?? null,
    }));
  }

  // ---------- 创建 / 更新 / 删除 ----------

  async create(fields: ItemCreateDto): Promise<ItemDto> {
    const name = normalizeItemName(fields.name); // M1：create 必填；非字符串/空白 → 400
    this.assertCommon(fields);
    if (fields.categoryId != null) await this.assertCategoryExists(fields.categoryId);
    const now = localTimestamp(new Date());
    const row = this.db
      .insert(items)
      .values({
        name,
        categoryId: fields.categoryId ?? null,
        purchaseDate: fields.purchaseDate ?? null,
        quantity: fields.quantity ?? 0,
        unit: fields.unit ?? null,
        price: fields.price ?? null,
        expiryDate: fields.expiryDate ?? null,
        openShelfDays: fields.openShelfDays ?? null,
        remindDays: fields.remindDays ?? null,
        minQuantity: fields.minQuantity ?? null,
        opened: 0,
        status: 'active',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return this.toDto(row[0], await this.defaultRemindDays());
  }

  async update(id: number, fields: ItemUpdateDto): Promise<ItemDto> {
    const existing = this.findOrFail(id);
    this.assertCommon(fields, existing);
    if (fields.categoryId !== undefined && fields.categoryId !== null) {
      await this.assertCategoryExists(fields.categoryId);
    }

    const patch: Partial<ItemRow> = { updatedAt: localTimestamp(new Date()) };

    const copyKeys: (keyof ItemCreateDto)[] = [
      'name', 'categoryId', 'purchaseDate', 'quantity', 'unit',
      'price', 'expiryDate', 'openShelfDays', 'remindDays', 'minQuantity',
    ];
    for (const k of copyKeys) {
      if (fields[k] !== undefined) {
        // M1/M8：name 提供时走 normalize（非字符串 → 400），落库用 trim 值；其余字段原样复制
        (patch as Record<string, unknown>)[k as string] =
          k === 'name' ? normalizeItemName(fields.name) : (fields[k] as unknown);
      }
    }

    // 开封状态：置 1 → server 写 opened_at=当日（幂等：已开封时不覆盖首次日期）；置 0 → 清空 opened_at
    if (fields.opened !== undefined) {
      if (fields.opened === 1) {
        patch.opened = 1;
        if (existing.opened !== 1) {
          patch.openedAt = todayISO();
        }
      } else if (fields.opened === 0) {
        patch.opened = 0;
        patch.openedAt = null;
      } else {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'opened 只能为 0 或 1');
      }
    }

    const row = this.db.update(items).set(patch).where(eq(items.id, id)).returning().all();
    return this.toDto(row[0], await this.defaultRemindDays());
  }

  async remove(id: number): Promise<{ id: number }> {
    this.findOrFail(id);
    this.db.delete(items).where(eq(items.id, id)).run();
    return { id };
  }

  // ---------- 归档 / 恢复 ----------

  async archive(id: number, reason: ArchiveReason): Promise<ItemDto> {
    const existing = this.findOrFail(id);
    if (reason !== 'used_up' && reason !== 'expired_discarded') {
      throw new ApiException(400, API_ERROR_CODES.ARCHIVE_REASON_INVALID, `归档去向非法：${String(reason)}`);
    }
    if (existing.status === 'archived') {
      // 幂等：已归档不覆盖首次归档原因，直接返回当前状态
      return this.toDto(existing, await this.defaultRemindDays());
    }
    const row = this.db
      .update(items)
      .set({
        status: 'archived',
        archivedReason: reason,
        archivedAt: localTimestamp(new Date()),
        updatedAt: localTimestamp(new Date()),
      })
      .where(eq(items.id, id))
      .returning()
      .all();
    return this.toDto(row[0], await this.defaultRemindDays());
  }

  async restore(id: number): Promise<ItemDto> {
    this.findOrFail(id);
    const row = this.db
      .update(items)
      .set({
        status: 'active',
        archivedReason: null,
        archivedAt: null,
        updatedAt: localTimestamp(new Date()),
      })
      .where(eq(items.id, id))
      .returning()
      .all();
    return this.toDto(row[0], await this.defaultRemindDays());
  }

  // ---------- 校验与映射 ----------

  private assertCommon(fields: ItemCreateDto | ItemUpdateDto, existing?: ItemRow): void {
    // name 校验已收敛到 normalizeItemName（M1/M8）：create 在入口调用（必填），
    // update 仅在提供 name 时调用；这里不再重复校验
    if (fields.quantity !== undefined) {
      if (typeof fields.quantity !== 'number' || !Number.isFinite(fields.quantity) || fields.quantity < 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'quantity 必须为 >= 0 的数字');
      }
    }
    if (fields.expiryDate != null && !isValidISODate(fields.expiryDate)) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `expiry_date 非法：${String(fields.expiryDate)}`);
    }
    if (fields.purchaseDate != null && !isValidISODate(fields.purchaseDate)) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `purchase_date 非法：${String(fields.purchaseDate)}`);
    }
    if (fields.price !== undefined && fields.price !== null) {
      if (typeof fields.price !== 'number' || !Number.isFinite(fields.price) || fields.price < 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'price 必须为 >= 0 的数字');
      }
    }
    if (fields.openShelfDays != null) {
      if (!Number.isInteger(fields.openShelfDays) || fields.openShelfDays <= 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'open_shelf_days 必须为正整数');
      }
    }
    // S-M2：minQuantity 是低库存判定的阈值字段（D-1 链路唯一缺校验的字段）——
    // 提供时必须为非负数，拒绝脏值入库（脏值会让前端低库存判定恒 false 且无从排查）
    if (fields.minQuantity !== undefined && fields.minQuantity !== null) {
      if (typeof fields.minQuantity !== 'number' || !Number.isFinite(fields.minQuantity) || fields.minQuantity < 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'minQuantity 必须为 >= 0 的数字');
      }
    }
    if (fields.remindDays != null) {
      if (!Number.isInteger(fields.remindDays) || fields.remindDays <= 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'remind_days 必须为正整数');
      }
    }
    if (fields.categoryId != null && !Number.isInteger(fields.categoryId)) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'category_id 必须为正整数');
    }
  }

  private async assertCategoryExists(categoryId: number): Promise<void> {
    const rows = this.db.select().from(categories).where(eq(categories.id, categoryId)).all();
    if (rows.length === 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `类别 ${categoryId} 不存在`);
    }
  }

  private findOrFail(id: number): ItemRow {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '路径参数 id 必须为正整数');
    }
    const rows = this.db.select().from(items).where(eq(items.id, id)).all();
    if (rows.length === 0) {
      throw new ApiException(404, API_ERROR_CODES.ITEM_NOT_FOUND, `物品 ${id} 不存在`);
    }
    return rows[0];
  }

  private async defaultRemindDays(): Promise<number> {
    try {
      const raw = await this.settingsService.getRaw();
      return raw.default_remind_days;
    } catch {
      return 3;
    }
  }

  /** ItemDto 映射 + 有效过期日/临期状态计算（expiryStatus：expired=当日 >= 有效过期日；expiring=距有效过期日 <= 阈值） */
  private toDto(r: ItemRow, defaultRemindDays: number): ItemDto {
    const effective = computeEffectiveExpiry({
      opened: r.opened,
      openedAt: r.openedAt,
      openShelfDays: r.openShelfDays,
      expiryDate: r.expiryDate,
    });
    const threshold = r.remindDays ?? defaultRemindDays;
    return {
      id: r.id,
      name: r.name,
      categoryId: r.categoryId ?? null,
      purchaseDate: r.purchaseDate ?? null,
      quantity: r.quantity ?? 0,
      unit: r.unit ?? null,
      price: r.price ?? null,
      expiryDate: r.expiryDate ?? null,
      opened: r.opened ?? 0,
      openedAt: r.openedAt ?? null,
      openShelfDays: r.openShelfDays ?? null,
      remindDays: r.remindDays ?? null,
      minQuantity: r.minQuantity ?? null,
      status: (r.status as 'active' | 'archived') ?? 'active',
      archivedReason: (r.archivedReason as ArchiveReason | null) ?? null,
      archivedAt: r.archivedAt ?? null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
      source: (r.source as ItemSource | null) ?? 'manual',
      effectiveExpiryDate: effective,
      expiryStatus: expiryStatus(effective, threshold),
    };
  }
}

/** 临期判定：none=无过期概念；expired=当日 >= 有效过期日（过期当天即过期，与提醒判定统一）；expiring=距有效过期日 <= 阈值；其余 ok */
export function expiryStatus(effective: string | null, remindDays: number): ExpiryStatus {
  if (!effective) return 'none';
  const today = todayISO();
  if (today >= effective) return 'expired';
  if (daysBetween(today, effective) <= remindDays) return 'expiring';
  return 'ok';
}

/** a、b 均为 YYYY-MM-DD；返回 b - a 的天数（同日为 0） */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** 本地日期字符串（YYYY-MM-DD） */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
