/**
 * 提醒引擎（规格 M3/M4/M6）：每日扫描 → 判定临期/过期 → 逐渠道派发 → 可选自动归档。
 *
 * 判定（规格 M3.1/M3.2）：
 * - 无有效过期日 → 跳过（M3.4 长期存储品）
 * - 今日 >= 有效过期日 → type=expired（过期当天发「已过期」）
 * - 否则 距过期日 <= 阈值 → type=expiring_soon
 * - 阈值 = item.remind_days ?? settings.default_remind_days（M6.2/M6.3）
 *
 * 去重（M3.1「提醒一次即可，不重复」+ 评审裁定）：
 * **每物品每类型终身只发一次**。判定命中后先查 NotificationLedger.hasAny（跨日期存在性），
 * 已存在则跳过；再 reserve 占位写入（DB 唯一约束兜底并发）。去重不依赖任何渠道，
 * 因此 inapp 关闭时 email/wecom 也不会重发。
 *
 * 自动归档（M4.1）：auto_archive_expired=1 且 今日 > 有效过期日（次日开始）→ expired_discarded。
 * 归档在通知派发完成之后进行：单渠道失败只记日志、不阻断归档（也不阻断其他渠道）。
 */
import { Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { computeEffectiveExpiry, type NotificationType, type ReminderRunChannelResult, type ReminderRunResult } from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { items } from '../db/schema';
import type { SettingsService, RawSettings } from '../settings/settings.service';
import type { NotifyDispatcher } from '../notifications/notify.dispatcher';
import { NotificationLedger } from '../notifications/notification-ledger';
import type { NotifyJob } from '../notifications/notifier';
import { daysBetween, localTimestamp, SystemClock, type Clock } from './clock';

type ItemRow = typeof items.$inferSelect;

export class ReminderService {
  /** 并发闸门：同一实例上并发的扫描复用同一次执行（brief：并发不双发） */
  private inFlight: Promise<ReminderRunResult> | null = null;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly settingsService: SettingsService,
    private readonly dispatcher: NotifyDispatcher,
    private readonly clock: Clock = new SystemClock(),
    private readonly ledger: NotificationLedger = new NotificationLedger(db, clock),
  ) {}

  run(): Promise<ReminderRunResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.scan().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** 单次扫描主流程 */
  private async scan(): Promise<ReminderRunResult> {
    const settings = await this.settingsService.getRaw();
    const today = this.clock.today();
    const rows = this.db.select().from(items).where(eq(items.status, 'active')).all();

    const channels: Record<string, ReminderRunChannelResult> = {};
    let notified = 0;
    let archived = 0;

    for (const row of rows) {
      const type = this.judge(row, settings, today);
      // 终身一次：该物品该类型已发过任意日期的通知 → 不再发。
      // 注意：hasAny 只按 (item_id, type)，因此物品改期 / 改阈值不会重置额度——已提醒过的类型不会重发。
      if (type && !this.ledger.hasAny(row.id, type)) {
        // 占位写入：并发扫描时只有一方拿到 true；itemName 为写入时快照（I-6）
        if (this.ledger.reserve(row.id, type, today, row.name)) {
          const job = this.buildJob(row, type, today);
          try {
            const results = await this.dispatcher.dispatch(job, settings);
            this.ledger.recordChannels(row.id, type, today, results);
            this.aggregate(channels, results);
            const delivered = Object.values(results).some((r) => r.ok && !r.skipped);
            const anyAttemptFailed = Object.values(results).some((r) => !r.ok && !r.skipped);
            if (delivered) {
              notified += 1;
            } else if (anyAttemptFailed) {
              // 评审 R1：所有启用渠道都失败 → 释放占位，避免终身额度被永久占用，次日可重试
              this.ledger.release(row.id, type, today);
            }
            // 全部 skipped（没有任何渠道启用）→ 不算失败、不释放、不重试
          } catch (e) {
            // 派发器内部已逐渠道隔离；这里兜住极端情况，保证扫描不中断
            const message = e instanceof Error ? e.message : String(e);
            this.aggregate(channels, { dispatch: { ok: false, error: message } });
            this.ledger.release(row.id, type, today);
          }
        }
      }

      // 通知流程已完成（上面 await 结束）再归档：单渠道失败不影响归档
      if (settings.auto_archive_expired === 1 && this.isPastExpiry(row, today)) {
        archived += this.archive(row, today) ? 1 : 0;
      }
    }

    // M5：扫描成功完成 → 记录当日，供调度器在容器重启后做补跑判定。
    // 写失败会随扫描一起失败（由调度器捕获记日志）：日期没写成就视为今天没跑过，
    // 重启后补跑——受终身一次去重保护，不会重发。
    await this.settingsService.setReminderLastRunDate(today);

    return { notified, archived, channels };
  }

  /** 按物品聚合渠道结果，而不是被最后一条覆盖 */
  private aggregate(
    channels: Record<string, ReminderRunChannelResult>,
    results: Record<string, { ok: boolean; skipped?: boolean; error?: string }>,
  ): void {
    for (const [name, r] of Object.entries(results)) {
      const slot = channels[name] ?? { ok: true, sent: 0, failed: 0 };
      if (r.ok) {
        if (!r.skipped) slot.sent += 1;
      } else {
        slot.failed += 1;
        slot.ok = false;
        if (r.error) slot.error = r.error;
      }
      channels[name] = slot;
    }
  }

  private effectiveExpiry(row: ItemRow): string | null {
    return computeEffectiveExpiry({
      opened: row.opened,
      openedAt: row.openedAt,
      openShelfDays: row.openShelfDays,
      expiryDate: row.expiryDate,
    });
  }

  private isPastExpiry(row: ItemRow, today: string): boolean {
    const effective = this.effectiveExpiry(row);
    return effective !== null && today > effective;
  }

  /** 判定本次应发通知类型；null=不提醒 */
  private judge(row: ItemRow, settings: RawSettings, today: string): NotificationType | null {
    const effective = this.effectiveExpiry(row);
    if (!effective) return null;
    if (today >= effective) return 'expired';
    const threshold = row.remindDays ?? settings.default_remind_days;
    return daysBetween(today, effective) <= threshold ? 'expiring_soon' : null;
  }

  private buildJob(row: ItemRow, type: NotificationType, today: string): NotifyJob {
    const effective = this.effectiveExpiry(row) as string;
    const qty = row.quantity ?? 0;
    const unit = row.unit ?? '';
    const title = type === 'expired' ? `【过期】${row.name}` : `【临期】${row.name}`;
    const when = type === 'expired' ? `已过期（有效期 ${effective}）` : `将于 ${effective} 过期`;
    const body = `${row.name} 共 ${qty}${unit}，${when}。今天是 ${today}，请尽快处理。`;
    return { itemId: row.id, itemName: row.name, type, sentDate: today, title, body };
  }

  /**
   * 自动归档（M4.1）。仅更新仍为 active 的行（评审 M2）：dispatch await 窗口内用户
   * 可能把物品手动归档为 used_up，无条件 UPDATE 会把它覆盖成 expired_discarded，
   * 浪费统计多计。返回是否真的归档了行（已被用户抢先归档 → false，不计入计数）。
   */
  private archive(row: ItemRow, today: string): boolean {
    const res = this.db
      .update(items)
      .set({
        status: 'archived',
        archivedReason: 'expired_discarded',
        archivedAt: today,
        updatedAt: localTimestamp(this.clock.now()),
      })
      .where(and(eq(items.id, row.id), eq(items.status, 'active')))
      .run();
    return res.changes > 0;
  }
}
