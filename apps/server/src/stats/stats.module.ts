import { DynamicModule, Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class StatsModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: StatsModule,
      controllers: [StatsController],
      providers: [StatsService, { provide: DB_TOKEN, useValue: db }],
    };
  }
}
