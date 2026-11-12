/**
 * 定时备份调度器（M8.3）：node-cron 按 BACKUP_INTERVAL（默认每日 02:00）执行，
 * 写入 BACKUP_DIR 并按 BACKUP_KEEP 清理旧文件。注册失败（非法表达式）只记 warn，不阻断启动。
 */
import { schedule as cronSchedule, type ScheduledTask } from 'node-cron';
import type { BackupLog } from './backup.service';

export interface BackupCronAdapter {
  schedule(expr: string, fn: () => void, opts?: { timezone?: string }): { stop(): void };
}

const defaultCron: BackupCronAdapter = {
  schedule(expr, fn, opts) {
    const task: ScheduledTask = cronSchedule(expr, fn, opts);
    return { stop: () => task.stop() };
  },
};

export interface BackupSchedulerOptions {
  interval?: string;
  timezone?: string;
  cron?: BackupCronAdapter;
  log?: BackupLog;
}

export interface BackupRunner {
  runScheduledBackup(): Promise<{ ok: boolean; file?: string; error?: string }>;
}

const consoleLog: BackupLog = (channel, level, message) => {
  const line = `[${channel}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export class BackupScheduler {
  private task: { stop(): void } | null = null;
  private readonly interval: string;
  private readonly timezone?: string;
  private readonly cron: BackupCronAdapter;
  private readonly log: BackupLog;

  constructor(
    private readonly backups: BackupRunner,
    options: BackupSchedulerOptions = {},
  ) {
    this.interval = options.interval ?? process.env.BACKUP_INTERVAL ?? '0 2 * * *';
    this.timezone = options.timezone ?? process.env.TZ ?? undefined;
    this.cron = options.cron ?? defaultCron;
    this.log = options.log ?? consoleLog;
  }

  onModuleInit(): void {
    this.schedule();
  }

  onModuleDestroy(): void {
    this.task?.stop();
    this.task = null;
  }

  schedule(): void {
    try {
      this.task = this.cron.schedule(
        this.interval,
        () => {
          void this.backups.runScheduledBackup();
        },
        this.timezone ? { timezone: this.timezone } : undefined,
      );
    } catch (e) {
      this.task = null;
      const detail = e instanceof Error ? e.message : String(e);
      this.log('backup', 'warn', `定时备份注册失败（${this.interval}）：${detail}`);
    }
  }
}
