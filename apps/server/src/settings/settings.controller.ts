import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { type SettingsDto, type SettingsUpdateDto } from '@home-stock/shared';
import { SettingsService } from './settings.service';

@Controller('api/settings')
export class SettingsController {
  // vitest 的 esbuild 不支持 emitDecoratorMetadata，DI 用显式 @Inject
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  async get(): Promise<{ data: SettingsDto }> {
    return { data: await this.settings.getMasked() };
  }

  @Put()
  async update(@Body() body: SettingsUpdateDto): Promise<{ data: SettingsDto }> {
    return { data: await this.settings.update(body ?? {}) };
  }
}
