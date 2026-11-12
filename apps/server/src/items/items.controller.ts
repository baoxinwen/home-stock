import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { assertNotForcedDbError } from '../common/test-hooks';
import { ApiException } from '../common/api.exception';
import { API_ERROR_CODES, type ArchiveReason, type ItemCreateDto, type ItemDto, type ItemHistoryDto, type ItemUpdateDto, type ApiResponse } from '@home-stock/shared';
import { ItemsService } from './items.service';

function badRequest(message: string): never {
  throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, message);
}

function parseId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) badRequest('路径参数 id 必须为正整数');
  return n;
}

@Controller('api/items')
export class ItemsController {
  // vitest 的 esbuild 不支持 emitDecoratorMetadata，DI 用显式 @Inject
  constructor(@Inject(ItemsService) private readonly svc: ItemsService) {}

  @Get('history')
  async history(
    @Req() req: Request,
    @Query('q') q?: string,
  ): Promise<ApiResponse<ItemHistoryDto[]>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.history(q ?? '') };
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ): Promise<ApiResponse<ItemDto[]>> {
    assertNotForcedDbError(req);
    if (status !== undefined && status !== '' && status !== 'active' && status !== 'archived') {
      badRequest(`status 非法：${status}（仅 active/archived）`);
    }
    let categoryNum: number | null = null;
    if (category !== undefined && category !== '') {
      const n = Number(category);
      if (!Number.isInteger(n) || n <= 0) badRequest('category 必须为正整数');
      categoryNum = n;
    }
    return { data: await this.svc.list(q ?? '', categoryNum, status === 'archived' ? 'archived' : 'active') };
  }

  @HttpCode(200)
  @Post(':id/archive')
  async archive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason?: unknown },
  ): Promise<ApiResponse<ItemDto>> {
    assertNotForcedDbError(req);
    const data = await this.svc.archive(parseId(id), body?.reason as ArchiveReason);
    return { data };
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(@Req() req: Request, @Param('id') id: string): Promise<ApiResponse<ItemDto>> {
    assertNotForcedDbError(req);
    const data = await this.svc.restore(parseId(id));
    return { data };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: ItemCreateDto): Promise<ApiResponse<ItemDto>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.create(body ?? {}) };
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ItemUpdateDto,
  ): Promise<ApiResponse<ItemDto>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.update(parseId(id), body ?? {}) };
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<ApiResponse<{ id: number }>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.remove(parseId(id)) };
  }
}
