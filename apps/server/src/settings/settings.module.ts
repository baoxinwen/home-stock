import { DynamicModule, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class SettingsModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: SettingsModule,
      controllers: [SettingsController],
      providers: [SettingsService, { provide: DB_TOKEN, useValue: db }],
      exports: [SettingsService],
    };
  }
}
