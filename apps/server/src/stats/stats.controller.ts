import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { WasteStatsDto } from '@home-stock/shared';
import { StatsService } from './stats.service';

@Controller('api/stats')
export class StatsController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  /** GET /api/stats/waste?period=YYYY-MM&groupBy=category|month */
  @Get('waste')
  async waste(
    @Query('period') period?: string,
    @Query('groupBy') groupBy?: string,
  ): Promise<{ data: WasteStatsDto }> {
    return { data: await this.stats.waste(period, groupBy) };
  }
}
