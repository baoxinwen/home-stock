import { DynamicModule, Module } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { InAppNotifier } from '../notifications/inapp.notifier';
import { EmailNotifier } from '../notifications/email.notifier';
import { WecomNotifier } from '../notifications/wecom.notifier';
import { NotifyDispatcher } from '../notifications/notify.dispatcher';
import { NotificationLedger } from '../notifications/notification-ledger';
import { SettingsService } from '../settings/settings.service';
import { DB_TOKEN } from '../db/db-token';
import type { Db } from '../db';
import { ReminderService } from './reminder.service';
import { ReminderScheduler } from './reminder.scheduler';
import { NotifyTestController, RemindersController } from './reminders.controller';
import { SystemClock } from './clock';

export interface RemindersModuleOptions {
  /** 测试环境关闭 cron 注册（默认开启） */
  scheduler?: boolean;
}

@Module({})
export class RemindersModule {
  static forRoot(db: Db, options: RemindersModuleOptions = {}): DynamicModule {
    const providers: unknown[] = [
      { provide: DB_TOKEN, useValue: db },
      SettingsService,
      NotificationsService,
      { provide: InAppNotifier, useFactory: () => new InAppNotifier() },
      { provide: EmailNotifier, useFactory: () => new EmailNotifier() },
      { provide: WecomNotifier, useFactory: () => new WecomNotifier() },
      {
        provide: NotifyDispatcher,
        useFactory: (inapp: InAppNotifier, email: EmailNotifier, wecom: WecomNotifier, logs: NotificationsService) =>
          new NotifyDispatcher([inapp, email, wecom], logs),
        inject: [InAppNotifier, EmailNotifier, WecomNotifier, NotificationsService],
      },
      {
        provide: NotificationLedger,
        useFactory: (d: Db) => new NotificationLedger(d),
        inject: [DB_TOKEN],
      },
      {
        provide: ReminderService,
        useFactory: (d: Db, settings: SettingsService, dispatcher: NotifyDispatcher, ledger: NotificationLedger) =>
          new ReminderService(d, settings, dispatcher, new SystemClock(), ledger),
        inject: [DB_TOKEN, SettingsService, NotifyDispatcher, NotificationLedger],
      },
    ];

    if (options.scheduler !== false) {
      providers.push({
        provide: ReminderScheduler,
        useFactory: (reminders: ReminderService, settings: SettingsService, logs: NotificationsService) =>
          new ReminderScheduler(reminders, settings, undefined, logs),
        inject: [ReminderService, SettingsService, NotificationsService],
      });
    }

    const exportsList: unknown[] = [ReminderService, NotifyDispatcher];
    if (options.scheduler !== false) exportsList.push(ReminderScheduler);

    return {
      module: RemindersModule,
      controllers: [RemindersController, NotifyTestController],
      providers: providers as never[],
      exports: exportsList as never[],
    };
  }
}
