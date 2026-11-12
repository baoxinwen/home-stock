import { DynamicModule, Module } from '@nestjs/common';
import { ShoppingController } from './shopping.controller';
import { ShoppingService } from './shopping.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class ShoppingModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: ShoppingModule,
      controllers: [ShoppingController],
      providers: [ShoppingService, { provide: DB_TOKEN, useValue: db }],
      exports: [ShoppingService],
    };
  }
}
