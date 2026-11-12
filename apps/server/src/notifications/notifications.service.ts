/**
 * 通知模块：应用内通知列表 / 标记已读 / 失败日志。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { NotificationDto, NotificationLogDto } from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { notificationLogs, notifications } from '../db/schema';
import { pruneNotificationLogs, type SqliteLike } from './log-retention';
import { localTimestamp } from '../reminders/clock';

type NotificationRow = typeof notifications.$inferSelect;
type LogRow = typeof notificationLogs.$inferSelect;

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  list(unreadOnly: boolean): NotificationDto[] {
    const rows: NotificationRow[] = unreadOnly
      ? this.db.select().from(notifications).where(eq(notifications.read, 0)).orderBy(desc(notifications.id)).all()
      : this.db.select().from(notifications).orderBy(desc(notifications.id)).all();
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId ?? null,
      itemName: r.itemName ?? null,
      type: (r.type as NotificationDto['type']) ?? null,
      sentDate: r.sentDate ?? null,
      channels: r.channels ?? null,
      read: r.read ?? 0,
      done: r.done ?? 0,
      createdAt: r.createdAt ?? null,
    }));
  }

  /** 标记已读：ids 缺省=全部；**空数组=no-op**（I-1，不可逆操作防误伤）；幂等 */
  markRead(ids?: number[]): { updated: number } {
    if (Array.isArray(ids)) {
      if (ids.length === 0) return { updated: 0 };
      const rows = this.db
        .update(notifications)
        .set({ read: 1 })
        .where(and(inArray(notifications.id, ids), eq(notifications.read, 0)))
        .returning()
        .all();
      return { updated: rows.length };
    }
    const rows = this.db
      .update(notifications)
      .set({ read: 1 })
      .where(eq(notifications.read, 0))
      .returning()
      .all();
    return { updated: rows.length };
  }

  /**
   * 标记完成（0004，GitHub inbox done 语义）：ids 缺省=全部；**空数组=no-op**（I-1）；幂等。
   * 完成 ⊃ 已读：同时置 read=1，未读徽章随之归零。done 不影响「终身一次」
   * 去重（ledger.hasAny 按存在性判定，done 行仍在表中，已完成的通知不会重发）。
   */
  markDone(ids?: number[]): { updated: number } {
    if (Array.isArray(ids)) {
      if (ids.length === 0) return { updated: 0 };
      const rows = this.db
        .update(notifications)
        .set({ done: 1, read: 1 })
        .where(and(inArray(notifications.id, ids), eq(notifications.done, 0)))
        .returning()
        .all();
      return { updated: rows.length };
    }
    const rows = this.db
      .update(notifications)
      .set({ done: 1, read: 1 })
      .where(eq(notifications.done, 0))
      .returning()
      .all();
    return { updated: rows.length };
  }

  /** 恢复到收件箱：仅清除 done（看过的还是看过），幂等 */
  undoDone(ids: number[]): { updated: number } {
    if (!Array.isArray(ids) || ids.length === 0) return { updated: 0 };
    const rows = this.db
      .update(notifications)
      .set({ done: 0 })
      .where(and(inArray(notifications.id, ids), eq(notifications.done, 1)))
      .returning()
      .all();
    return { updated: rows.length };
  }

  unreadCount(): number {
    const rows = this.db.select().from(notifications).where(eq(notifications.read, 0)).all();
    return rows.length;
  }

  logs(): NotificationLogDto[] {
    const rows: LogRow[] = this.db.select().from(notificationLogs).orderBy(desc(notificationLogs.id)).limit(100).all();
    return rows.map((r) => ({
      id: r.id,
      channel: (r.channel as NotificationLogDto['channel']) ?? null,
      level: r.level ?? null,
      message: r.message ?? null,
      createdAt: r.createdAt ?? null,
    }));
  }

  /** 供渠道/引擎写日志（error/warn=失败，info=测试发送等可观察证据）；写入后做保留上限清理（M6） */
  log(channel: string, level: 'error' | 'warn' | 'info', message: string): void {
    this.db
      .insert(notificationLogs)
      .values({ channel, level, message, createdAt: localTimestamp(new Date()) })
      .run();
    pruneNotificationLogs((this.db as unknown as { $client: SqliteLike }).$client);
  }
}
