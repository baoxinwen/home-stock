/**
 * 通知记录 + 去重权威（评审 Important 1/2）：
 *
 * 规格 M3.1「提醒一次即可，不重复」+ 用户裁定 → **每物品每类型终身只发一次**。
 * 去重不再依赖 inapp 渠道写库，而是由本服务在派发前统一做“存在性检查 + 占位写入”，
 * 因此 inapp 渠道关闭时 email/wecom 同样不会重发。
 *
 * notifications 表仍保留 UNIQUE(item_id,type,sent_date) 作为并发兜底（同一秒两次扫描时
 * 第二次插入被 DB 拒绝，reserve 返回 false）。
 */
import { localTimestamp, SystemClock, type Clock } from '../reminders/clock';
import type { NotificationType } from '@home-stock/shared';
import type { Db } from '../db';

type SqliteLike = {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
};

export class NotificationLedger {
  /**
   * 不缓存连接对象（评审 C-1 根因修复）：db 是 ReopenableDbHandle 的稳定代理
   * （handle.db），恢复备份会 close → rename → reopen 替换底层连接；若在构造时
   * 一次性解引用 $client，restore 之后本类仍握着已关闭的旧连接，每次扫描
   * prepare 即抛 "The database connection is not open"，三通道提醒停发直到重启。
   * 因此改为每次调用实时解引用当前连接（构造函数只持有代理本身）。
   */
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  /** 当前真实 SQLite 连接（每次调用实时取，跟随 reopen 切换） */
  private get sqlite(): SqliteLike {
    return (this.db as unknown as { $client: SqliteLike }).$client;
  }

  /** 该物品该类型是否已有过任意日期的通知（终身一次判定） */
  hasAny(itemId: number, type: NotificationType): boolean {
    const row = this.sqlite
      .prepare(`SELECT 1 FROM notifications WHERE item_id = ? AND type = ? LIMIT 1`)
      .get(itemId, type);
    return row !== undefined;
  }

  /**
   * 占位写入：成功=true（本次由我发送）；false=已存在（同类型已发过 / 并发扫描抢先）。
   * 使用 INSERT OR IGNORE，靠 DB 唯一约束兜底并发。
   * itemName 为物品名快照（I-6）：物品后续改名/删除不影响已发通知的展示。
   */
  reserve(itemId: number, type: NotificationType, sentDate: string, itemName: string | null = null): boolean {
    const res = this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO notifications (item_id, type, sent_date, channels, read, created_at, item_name)
         VALUES (?, ?, ?, NULL, 0, ?, ?)`,
      )
      .run(itemId, type, sentDate, localTimestamp(this.clock.now()), itemName);
    return res.changes > 0;
  }

  /** 回写各渠道发送结果（通知中心展示用） */
  recordChannels(itemId: number, type: NotificationType, sentDate: string, results: unknown): void {
    this.sqlite
      .prepare(`UPDATE notifications SET channels = ? WHERE item_id = ? AND type = ? AND sent_date = ?`)
      .run(JSON.stringify(results), itemId, type, sentDate);
  }

  /**
   * 释放占位（评审 R1）：本次扫描所有启用渠道都失败时调用，让终身额度回到“未发送”状态，
   * 下一次扫描可以重试。部分渠道成功或全部渠道未启用时不释放。
   */
  release(itemId: number, type: NotificationType, sentDate: string): void {
    this.sqlite
      .prepare(`DELETE FROM notifications WHERE item_id = ? AND type = ? AND sent_date = ?`)
      .run(itemId, type, sentDate);
  }

  /** 测试/诊断用：该物品该类型的通知行数 */
  countOf(itemId: number, type: NotificationType): number {
    const rows = this.sqlite
      .prepare(`SELECT id FROM notifications WHERE item_id = ? AND type = ?`)
      .all(itemId, type) as unknown[];
    return rows.length;
  }
}
