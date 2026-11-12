/**
 * 调度器（规格 M6.1 + 第 9 节）：node-cron 每日在 settings.reminder_hour 点执行一次扫描。
 * - 启动时按当前设置注册；settings 变更（进程内事件总线）→ 重建任务
 * - 扫描异常捕获并写 notification_logs，单次失败不影响下一周期
 * - 可直接调用 runNow() 手动触发（测试与 POST /api/reminders/run 复用同一逻辑）
 */
import { schedule as cronSchedule, type ScheduledTask } from 'node-cron';
import type { LogSink } from '../notifications/notifier';
import type { RawSettings } from '../settings/settings.service';
import { settingsBus } from '../settings/settings.service';
import type { ReminderService } from './reminder.service';
import { SystemClock, type Clock } from './clock';

/** 最小 cron 适配器，便于测试注入假调度器 */
export interface CronAdapter {
  schedule(expr: string, fn: () => void, opts?: { timezone?: string }): { stop(): void };
}

const defaultCron: CronAdapter = {
  schedule(expr, fn, opts) {
    const task: ScheduledTask = cronSchedule(expr, fn, opts);
    return { stop: () => task.stop() };
  },
};

const FALLBACK_HOUR = 8;

export class ReminderScheduler {
  private task: { stop(): void } | null = null;
  private hour = FALLBACK_HOUR;
  private readonly onSettingsUpdated = (): void => {
    void this.rebuild().catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      this.logs?.log('scheduler', 'warn', `重建提醒任务失败：${message}`);
    });
  };

  constructor(
    private readonly reminders: ReminderService,
    private readonly settings: {
      getRaw(): Promise<RawSettings>;
      getReminderLastRunDate(): Promise<string | null>;
    },
    private readonly cron: CronAdapter = defaultCron,
    private readonly logs?: LogSink,
    private readonly clock: Clock = new SystemClock(),
  ) {
    // 构造即订阅：settings 变更（含 HTTP PUT /api/settings）后按新时刻重建任务
    settingsBus.on('updated', this.onSettingsUpdated);
  }

  /** 启动：按当前设置注册每日任务；随后检查是否需要补跑错过的今日扫描（M5） */
  async onModuleInit(): Promise<void> {
    await this.rebuild();
    await this.catchUpMissedRun();
  }

  onModuleDestroy(): void {
    settingsBus.off('updated', this.onSettingsUpdated);
    this.stop();
  }

  /** 读取设置并（重新）注册任务 */
  async rebuild(): Promise<void> {
    const raw = await this.settings.getRaw();
    this.setHour(raw.reminder_hour);
  }

  /** 注册/替换任务；非法 hour 回退 8 点（库被手改坏也不崩） */
  setHour(hour: number): void {
    this.hour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : FALLBACK_HOUR;
    this.stop();
    const expr = this.expression();
    const timezone = process.env.TZ || undefined;
    this.task = this.cron.schedule(
      expr,
      () => {
        void this.runNow();
      },
      timezone ? { timezone } : undefined,
    );
  }

  expression(): string {
    return `0 ${this.hour} * * *`;
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  /** 执行一次扫描（异常捕获 + 记录） */
  async runNow(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.reminders.run();
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logs?.log('scheduler', 'error', `提醒扫描失败：${message}`);
      return { ok: false, error: message };
    }
  }

  /**
   * M5 重启补跑：容器在今日 reminder_hour 之后重启（此前一天未成功跑过）时，
   * node-cron 不会回填错过的触发 → 「过期当天提醒」整体晚一天。启动时若
   * 今日 > last_run_date 且当前时刻已过今日 reminder_hour → 立即补扫一次。
   * 补跑复用 runNow 路径（写入 reminder_last_run_date + 日志）；重发由
   * NotificationLedger 终身一次去重天然保护。
   */
  private async catchUpMissedRun(): Promise<void> {
    try {
      const raw = await this.settings.getRaw();
      const lastRun = await this.settings.getReminderLastRunDate();
      const today = this.clock.today();
      if (lastRun && lastRun >= today) return; // 今天已经跑过（含日期被写为未来，视为已跑）
      const hour =
        Number.isInteger(raw.reminder_hour) && raw.reminder_hour >= 0 && raw.reminder_hour <= 23
          ? raw.reminder_hour
          : FALLBACK_HOUR;
      if (this.clock.now().getHours() < hour) return; // 还没到今日时刻，交给当日 cron
      this.logs?.log(
        'scheduler',
        'info',
        `启动补跑：上次成功运行 ${lastRun ?? '从未'}，今日 ${hour} 点已过 → 立即补扫一次`,
      );
      await this.runNow();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logs?.log('scheduler', 'warn', `启动补跑检查失败：${message}`);
    }
  }
}
