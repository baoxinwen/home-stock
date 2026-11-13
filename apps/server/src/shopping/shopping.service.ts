import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  API_ERROR_CODES,
  type ConvertItemPayloadDto,
  type ConvertResult,
  type ItemDto,
  type ShoppingItemCreateDto,
  type ShoppingItemDto,
  type ShoppingItemStatus,
  type ShoppingItemUpdateDto,
} from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { categories, items, shoppingListItems } from '../db/schema';
import { ApiException } from '../common/api.exception';
import { localTimestamp } from '../reminders/clock';

type ShoppingRow = typeof shoppingListItems.$inferSelect;
type ItemRow = typeof items.$inferSelect;

/**
 * 购物清单（M5）：增删改查、勾选完成、转库存。
 * - 排序按 id 倒序（= 创建先后；表结构无 created_at，规格第 5 节数据模型为准）
 * - 转库存为终态：条件更新并插入 active 物品，同事务完成（并发重复只成功一次）
 */
@Injectable()
export class ShoppingService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  // ---------- 查询 ----------

  async list(status?: ShoppingItemStatus): Promise<ShoppingItemDto[]> {
    const rows = this.db
      .select()
      .from(shoppingListItems)
      .where(status ? eq(shoppingListItems.status, status) : undefined)
      .orderBy(desc(shoppingListItems.id))
      .all();
    return rows.map((r) => toDto(r));
  }

  // ---------- 创建 / 更新 / 删除 ----------

  async create(fields: ShoppingItemCreateDto): Promise<ShoppingItemDto> {
    const name = normalizeName(fields.name);
    const quantity = fields.quantity === undefined ? 1 : assertQuantity(fields.quantity);
    const price = assertPrice(fields.price);
    if (fields.categoryId != null) {
      assertCategoryId(fields.categoryId);
      await this.assertCategoryExists(fields.categoryId);
    }

    const row = this.db
      .insert(shoppingListItems)
      .values({
        name,
        quantity,
        unit: fields.unit ?? null,
        price,
        categoryId: fields.categoryId ?? null,
        status: 'pending',
      })
      .returning()
      .all();
    return toDto(row[0]);
  }

  async update(id: number, fields: ShoppingItemUpdateDto): Promise<ShoppingItemDto> {
    const existing = this.findOrFail(id);
    if (existing.status === 'converted') {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '已转为库存的清单项不可修改');
    }

    const patch: Partial<ShoppingRow> = {};
    if (fields.name !== undefined) patch.name = normalizeName(fields.name);
    if (fields.quantity !== undefined) patch.quantity = assertQuantity(fields.quantity);
    if (fields.unit !== undefined) patch.unit = fields.unit;
    if (fields.price !== undefined) patch.price = assertPrice(fields.price);
    if (fields.categoryId !== undefined) {
      if (fields.categoryId !== null) {
        assertCategoryId(fields.categoryId);
        await this.assertCategoryExists(fields.categoryId);
      }
      patch.categoryId = fields.categoryId;
    }
    if (fields.status !== undefined) {
      if (fields.status !== 'pending' && fields.status !== 'done') {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'status 只能为 pending 或 done');
      }
      patch.status = fields.status;
    }

    if (Object.keys(patch).length === 0) return toDto(existing);

    const row = this.db
      .update(shoppingListItems)
      .set(patch)
      .where(eq(shoppingListItems.id, id))
      .returning()
      .all();
    return toDto(row[0]);
  }

  async remove(id: number): Promise<{ id: number }> {
    this.findOrFail(id);
    this.db.delete(shoppingListItems).where(eq(shoppingListItems.id, id)).run();
    return { id };
  }

  // ---------- 转库存（M5.2 / M5.3） ----------

  /**
   * 转库存（M5.2 / M5.3）。
   * payload 有内容 = 表单确认转换：物品完全按 payload 生成（名称/数量在此校验）；
   * 缺省 = 快捷转换（批量一键）：物品按清单项字段生成，过期日期为空（M5.3 待补兜底）。
   * 两者同一事务内 claim 清单项 + 生成物品，并发重复 convert 只有一方成功。
   */
  async convert(id: number, payload?: ConvertItemPayloadDto): Promise<ConvertResult> {
    assertId(id);
    const form = normalizeConvertPayload(payload);
    return this.db.transaction((tx) => {
      const rows = tx.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).all();
      if (rows.length === 0) {
        throw new ApiException(404, API_ERROR_CODES.NOT_FOUND, `清单项 ${id} 不存在`);
      }
      const shopping = rows[0];
      if (shopping.status === 'converted') {
        throw new ApiException(409, API_ERROR_CODES.ITEM_ALREADY_CONVERTED, '该清单项已转为库存');
      }
      const quantity = form?.quantity ?? shopping.quantity;
      if (quantity == null || quantity <= 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'quantity 必须大于 0 才能转为库存');
      }

      // 条件更新（status <> converted）：并发重复 convert 只有一方能拿到行，另一方 409
      const claimed = tx
        .update(shoppingListItems)
        .set({ status: 'converted' })
        .where(and(eq(shoppingListItems.id, id), ne(shoppingListItems.status, 'converted')))
        .returning()
        .all();
      if (claimed.length === 0) {
        throw new ApiException(409, API_ERROR_CODES.ITEM_ALREADY_CONVERTED, '该清单项已转为库存');
      }

      const now = localTimestamp(new Date());
      // 类别可能在清单项创建后被删除（categories.remove 只检查 items）；降级为 null，避免外键 500
      let categoryId = form ? (form.categoryId ?? null) : (shopping.categoryId ?? null);
      if (categoryId !== null) {
        const cat = tx.select().from(categories).where(eq(categories.id, categoryId)).all();
        if (cat.length === 0) categoryId = null;
      }
      const itemRow = tx
        .insert(items)
        .values({
          // 表单确认转换按 payload；快捷转换按清单项字段（M5.2）
          name: form ? form.name : shopping.name,
          categoryId,
          // D-5：转库存即「刚买到」，购买日期默认当天（表单确认可改）
          purchaseDate: form?.purchaseDate ?? now.slice(0, 10),
          quantity,
          unit: form ? (form.unit ?? null) : (shopping.unit ?? null),
          price: form ? (form.price ?? null) : (shopping.price ?? null),
          // M5.3：快捷转换不带过期日 → 列表「待补过期日」兜底；表单确认由用户显式选择（含长期存储 null）
          expiryDate: form ? (form.expiryDate ?? null) : null,
          openShelfDays: form ? (form.openShelfDays ?? null) : null,
          remindDays: form ? (form.remindDays ?? null) : null,
          minQuantity: form ? (form.minQuantity ?? null) : null,
          opened: 0,
          status: 'active',
          source: 'shopping',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .all()[0];

      return { item: toItemDto(itemRow), shoppingItem: toDto(claimed[0]) };
    });
  }

  /** 清空全部已转换项（M5.2「可手动清空」），返回删除条数 */
  async clearConverted(): Promise<{ deleted: number }> {
    const deleted = this.db
      .delete(shoppingListItems)
      .where(eq(shoppingListItems.status, 'converted'))
      .returning({ id: shoppingListItems.id })
      .all();
    return { deleted: deleted.length };
  }

  // ---------- 校验 ----------

  private findOrFail(id: number): ShoppingRow {
    assertId(id);
    const rows = this.db.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).all();
    if (rows.length === 0) {
      throw new ApiException(404, API_ERROR_CODES.NOT_FOUND, `清单项 ${id} 不存在`);
    }
    return rows[0];
  }

  private async assertCategoryExists(categoryId: number): Promise<void> {
    const rows = this.db.select().from(categories).where(eq(categories.id, categoryId)).all();
    if (rows.length === 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `类别 ${categoryId} 不存在`);
    }
  }
}

function assertId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '路径参数 id 必须为正整数');
  }
}

function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > 100) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'name 必填且不超过 100 字符');
  }
  return name;
}

/** 表单确认转换的归一结果（字段与 items 表插入列对应） */
interface NormalizedConvertPayload {
  name: string;
  quantity: number;
  categoryId: number | null;
  purchaseDate: string | null;
  unit: string | null;
  price: number | null;
  expiryDate: string | null;
  openShelfDays: number | null;
  remindDays: number | null;
  minQuantity: number | null;
}

/**
 * 表单确认 payload 归一：undefined / 无自有键的空对象 → undefined（走快捷转换）；
 * 有内容 → name 必填归一 + quantity 正数校验（表单路径 quantity 必填，
 * 快捷转换才回落清单项 quantity）。日期/阈值字段透传（与 create 同宽）。
 */
function normalizeConvertPayload(payload?: ConvertItemPayloadDto): NormalizedConvertPayload | undefined {
  if (payload == null || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return undefined;
  }
  const quantity = payload.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'quantity 必须大于 0 才能转为库存');
  }
  return {
    name: normalizeName(payload.name),
    quantity,
    categoryId: payload.categoryId ?? null,
    purchaseDate: payload.purchaseDate ?? null,
    unit: payload.unit ?? null,
    price: assertPrice(payload.price),
    expiryDate: payload.expiryDate ?? null,
    openShelfDays: payload.openShelfDays ?? null,
    remindDays: payload.remindDays ?? null,
    minQuantity: payload.minQuantity ?? null,
  };
}

function assertQuantity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'quantity 必须为 >= 0 的数字');
  }
  return raw;
}

function assertPrice(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'price 必须为 >= 0 的数字');
  }
  return raw;
}

function assertCategoryId(raw: unknown): void {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'category_id 必须为正整数');
  }
}

function toDto(r: ShoppingRow): ShoppingItemDto {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity ?? 0,
    unit: r.unit ?? null,
    price: r.price ?? null,
    categoryId: r.categoryId ?? null,
    status: (r.status as ShoppingItemStatus) ?? 'pending',
  };
}

/** 转库存生成的物品无过期日（M5.3）：映射为长期存储品（expiryStatus=none） */
function toItemDto(r: ItemRow): ItemDto {
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
    status: 'active',
    archivedReason: null,
    archivedAt: null,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
    source: 'shopping',
    imagePath: r.imagePath ?? null,
    effectiveExpiryDate: null,
    expiryStatus: 'none',
  };
}
