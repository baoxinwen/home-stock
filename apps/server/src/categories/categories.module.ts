import { DynamicModule, Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class CategoriesModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: CategoriesModule,
      controllers: [CategoriesController],
      providers: [CategoriesService, { provide: DB_TOKEN, useValue: db }],
      exports: [CategoriesService],
    };
  }
}
