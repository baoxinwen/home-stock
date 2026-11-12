import { DynamicModule, Module } from '@nestjs/common';
import type { DbHandle } from '../db/handle';
import { pruneNotificationLogs } from '../notifications/log-retention';
import { localTimestamp } from '../reminders/clock';
import { BackupController } from './backup.controller';
import { BackupScheduler } from './backup.scheduler';
import { BackupService, type BackupLog } from './backup.service';

export interface BackupModuleOptions {
  /** BACKUP_DIR */
  backupDir: string;
  /** BACKUP_KEEP；默认读 env / 14 */
  keep?: number;
  /** 是否注册定时备份；测试环境关闭 */
  scheduler?: boolean;
  /** 日志出口（默认 console + notification_logs） */
  log?: BackupLog;
}

/** 备份日志：console + notification_logs（数据库不可用时静默降级） */
function createDbLog(handle: DbHandle): BackupLog {
  return (channel, level, message) => {
    const line = `[${channel}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    try {
      if (handle.sqlite.open) {
        handle.sqlite
          .prepare(
            `INSERT INTO notification_logs (channel, level, message, created_at) VALUES (?, ?, ?, ?)`,
          )
          .run(channel, level, message, localTimestamp(new Date()));
        pruneNotificationLogs(handle.sqlite);
      }
    } catch {
      // DB 只读/关闭时只保留 console
    }
  };
}

@Module({})
export class BackupModule {
  static forRoot(handle: DbHandle, options: BackupModuleOptions): DynamicModule {
    const log = options.log ?? createDbLog(handle);
    const providers: unknown[] = [
      {
        provide: BackupService,
        useFactory: () =>
          new BackupService(handle, {
            backupDir: options.backupDir,
            keep: options.keep,
            log,
          }),
      },
    ];

    if (options.scheduler !== false) {
      providers.push({
        provide: BackupScheduler,
        useFactory: (service: BackupService) => new BackupScheduler(service, { log }),
        inject: [BackupService],
      });
    }

    return {
      module: BackupModule,
      controllers: [BackupController],
      providers: providers as never[],
      exports: [BackupService, ...(options.scheduler !== false ? [BackupScheduler] : [])],
    };
  }
}
