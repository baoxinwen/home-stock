import { DynamicModule, Module, Provider } from '@nestjs/common';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { UploadsController } from './uploads.controller';
import { UPLOADS_DIR_TOKEN, UploadsService } from './uploads.service';

/**
 * 物品图片模块（P1 单图）。forRoot 注入共享 Db 与 uploads 目录；
 * 导出 UploadsService 供 items 模块做换图/删图的文件清理联动。
 */
@Module({})
export class UploadsModule {
  static forRoot(db: Db, options: { uploadsDir: string }): DynamicModule {
    const dbProvider: Provider = { provide: DB_TOKEN, useValue: db };
    const dirProvider: Provider = { provide: UPLOADS_DIR_TOKEN, useValue: options.uploadsDir };
    return {
      module: UploadsModule,
      controllers: [UploadsController],
      providers: [dbProvider, dirProvider, UploadsService],
      exports: [UploadsService],
    };
  }
}
