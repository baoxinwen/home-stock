import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  API_ERROR_CODES,
  SHOPPING_ITEM_STATUSES,
  type ApiResponse,
  type ConvertItemPayloadDto,
  type ConvertResult,
  type ShoppingItemCreateDto,
  type ShoppingItemDto,
  type ShoppingItemStatus,
  type ShoppingItemUpdateDto,
} from '@home-stock/shared';
import { ApiException } from '../common/api.exception';
import { assertNotForcedDbError } from '../common/test-hooks';
import { ShoppingService } from './shopping.service';

function badRequest(message: string): never {
  throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, message);
}

function parseId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) badRequest('路径参数 id 必须为正整数');
  return n;
}

@Controller('api/shopping-items')
export class ShoppingController {
  // vitest 的 esbuild 不支持 emitDecoratorMetadata，DI 用显式 @Inject
  constructor(@Inject(ShoppingService) private readonly svc: ShoppingService) {}

  @Get()
  async list(@Req() req: Request, @Query('status') status?: string): Promise<ApiResponse<ShoppingItemDto[]>> {
    assertNotForcedDbError(req);
    if (status !== undefined && status !== '' && !SHOPPING_ITEM_STATUSES.includes(status as ShoppingItemStatus)) {
      badRequest(`status 非法：${status}（仅 pending/done/converted）`);
    }
    const filter = status ? (status as ShoppingItemStatus) : undefined;
    return { data: await this.svc.list(filter) };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: ShoppingItemCreateDto): Promise<ApiResponse<ShoppingItemDto>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.create(body ?? {}) };
  }

  /** 必须早于 DELETE /:id 注册，否则 'converted' 会被当作 id */
  @Delete('converted')
  async clearConverted(@Req() req: Request): Promise<ApiResponse<{ deleted: number }>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.clearConverted() };
  }

  @HttpCode(200)
  @Post(':id/convert')
  async convert(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() payload?: ConvertItemPayloadDto,
  ): Promise<ApiResponse<ConvertResult>> {
    assertNotForcedDbError(req);
    // payload 有内容 = 表单确认转换（按 payload 生成物品）；缺省 = 快捷转换（批量一键，按清单项字段）
    return { data: await this.svc.convert(parseId(id), payload ?? undefined) };
  }

  @Put(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ShoppingItemUpdateDto,
  ): Promise<ApiResponse<ShoppingItemDto>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.update(parseId(id), body ?? {}) };
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<ApiResponse<{ id: number }>> {
    assertNotForcedDbError(req);
    return { data: await this.svc.remove(parseId(id)) };
  }
}
