import { Body, Controller, Delete, Get, HttpException, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { assertNotForcedDbError } from '../common/test-hooks';
import { CategoriesService } from './categories.service';
import type { ApiResponse, CategoryDto } from '@home-stock/shared';

function validationError(message: string): never {
  throw new HttpException({ code: 'VALIDATION_ERROR', message }, 400);
}

function normalizeSortOrder(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  validationError('sortOrder 必须为数字');
}

function parseId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    validationError('路径参数 id 必须为正整数');
  }
  return n;
}

@Controller('api/categories')
export class CategoriesController {
  // vitest 的 esbuild 转译不支持 emitDecoratorMetadata，Nest DI 必须用显式 @Inject（self:paramtypes）
  constructor(@Inject(CategoriesService) private readonly svc: CategoriesService) {}

  @Get()
  async list(@Req() req: Request): Promise<ApiResponse<CategoryDto[]>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.list() };
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { name?: unknown; sortOrder?: unknown },
  ): Promise<ApiResponse<CategoryDto>> {
    assertNotForcedDbError(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      validationError('name 必填且不超过 100 字符');
    }
    const sortOrder = normalizeSortOrder(body?.sortOrder);
    return { data: await this.svc.create(name, sortOrder) };
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name?: unknown; sortOrder?: unknown },
  ): Promise<ApiResponse<CategoryDto>> {
    assertNotForcedDbError(req);
    const patch: { name?: string; sortOrder?: number | null } = {};
    if (body?.name !== undefined) {
      if (typeof body.name !== 'string') {
        validationError('name 必须为字符串');
      }
      patch.name = body.name;
    }
    if (body?.sortOrder !== undefined) patch.sortOrder = normalizeSortOrder(body.sortOrder);
    return { data: await this.svc.update(parseId(id), patch) };
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<ApiResponse<{ id: number }>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.remove(parseId(id)) };
  }
}
