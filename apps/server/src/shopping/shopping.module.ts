import { DynamicModule, Module } from '@nestjs/common';
import { ShoppingController } from './shopping.controller';
import { ShoppingService } from './shopping.service';
import { SettingsService } from '../settings/settings.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class ShoppingModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: ShoppingModule,
      controllers: [ShoppingController],
      // SettingsService 直配 provider（同 ItemsModule 先例）：convert 响应临期口径需要 default_remind_days
      providers: [ShoppingService, SettingsService, { provide: DB_TOKEN, useValue: db }],
      exports: [ShoppingService],
    };
  }
}
