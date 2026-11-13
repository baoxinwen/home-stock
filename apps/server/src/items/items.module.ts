import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { SettingsService } from '../settings/settings.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';
import { UPLOADS_DIR_TOKEN, UploadsService } from '../uploads/uploads.service';

@Module({})
export class ItemsModule {
  static forRoot(db: Db, options: { uploadsDir: string }): DynamicModule {
    const dbProvider: Provider = { provide: DB_TOKEN, useValue: db };
    const uploadsDirProvider: Provider = { provide: UPLOADS_DIR_TOKEN, useValue: options.uploadsDir };
    return {
      module: ItemsModule,
      controllers: [ItemsController],
      // UploadsService 直接实例化（同一 token 契约）：换图/删图的文件清理由 ItemsService 直调
      providers: [ItemsService, SettingsService, UploadsService, dbProvider, uploadsDirProvider],
      exports: [ItemsService, SettingsService],
    };
  }
}
