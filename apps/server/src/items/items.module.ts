import { DynamicModule, Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { SettingsService } from '../settings/settings.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class ItemsModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: ItemsModule,
      controllers: [ItemsController],
      providers: [ItemsService, SettingsService, { provide: DB_TOKEN, useValue: db }],
      exports: [ItemsService, SettingsService],
    };
  }
}
