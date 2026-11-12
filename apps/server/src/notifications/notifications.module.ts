import { DynamicModule, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';

@Module({})
export class NotificationsModule {
  static forRoot(db: Db): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [NotificationsService, { provide: DB_TOKEN, useValue: db }],
      exports: [NotificationsService],
    };
  }
}
