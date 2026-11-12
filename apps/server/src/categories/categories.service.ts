import { Inject, Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { categories, items } from '../db/schema';
import { ApiException } from '../common/api.exception';
import { API_ERROR_CODES, type CategoryDto } from '@home-stock/shared';

const NAME_MAX = 100;

@Injectable()
export class CategoriesService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  private toDto(row: typeof categories.$inferSelect): CategoryDto {
    return { id: row.id, name: row.name, sortOrder: row.sortOrder ?? null };
  }

  async list(): Promise<CategoryDto[]> {
    const rows = this.db.select().from(categories).orderBy(asc(categories.sortOrder)).all();
    return rows.map((r) => this.toDto(r));
  }

  async create(name: string, sortOrder: number | null): Promise<CategoryDto> {
    await this.assertNameUsable(name);
    // D-M8：未显式指定排序时排到末尾（SQLite ORDER BY ASC 对 NULL 先行，null 会插队到最前）
    const effective = sortOrder ?? this.maxSortOrder() + 1;
    const row = this.db.insert(categories).values({ name, sortOrder: effective }).returning().all();
    return this.toDto(row[0]);
  }

  async update(id: number, patch: { name?: string; sortOrder?: number | null }): Promise<CategoryDto> {
    const existing = await this.findOrFail(id);
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name || name.length > NAME_MAX) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `name 必填且不超过 ${NAME_MAX} 字符`);
      }
      await this.assertNameUsable(name, id);
      existing.name = name;
    }
    if (patch.sortOrder !== undefined) {
      existing.sortOrder = patch.sortOrder;
    }
    const row = this.db.update(categories).set({ name: existing.name, sortOrder: existing.sortOrder }).where(eq(categories.id, id)).returning().all();
    return this.toDto(row[0]);
  }

  /** 当前最大 sortOrder（空表返回 0） */
  private maxSortOrder(): number {
    const rows = this.db.select({ sortOrder: categories.sortOrder }).from(categories).all();
    return rows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0);
  }

  async remove(id: number): Promise<{ id: number }> {
    await this.findOrFail(id);
    const used = this.db.select().from(items).where(eq(items.categoryId, id)).all();
    if (used.length > 0) {
      throw new ApiException(409, API_ERROR_CODES.CATEGORY_IN_USE, '类别下仍有物品，禁止删除');
    }
    this.db.delete(categories).where(eq(categories.id, id)).run();
    return { id };
  }

  private async findOrFail(id: number) {
    const rows = this.db.select().from(categories).where(eq(categories.id, id)).all();
    if (rows.length === 0) {
      throw new ApiException(404, API_ERROR_CODES.CATEGORY_NOT_FOUND, `类别 ${id} 不存在`);
    }
    return rows[0];
  }

  private async assertNameUsable(name: string, excludeId?: number): Promise<void> {
    const all = this.db.select().from(categories).all();
    const dup = all.some((c) => c.name === name && c.id !== excludeId);
    if (dup) {
      throw new ApiException(409, API_ERROR_CODES.DUPLICATE_NAME, `类别 "${name}" 已存在`);
    }
  }
}
