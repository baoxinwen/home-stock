/**
 * Task5 RED — 提醒引擎（判定 / 去重 / 自动归档 / 可注入时钟）。
 * 规格权威：requirements.md M3.1–M3.4（临期边界、过期当天、去重、长期存储品）、M4.1/M4.2、M6.2/M6.3。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { createDb, type Db } from '../src/db';
import { SettingsService } from '../src/settings/settings.service';
import { InAppNotifier } from '../src/notifications/inapp.notifier';
import { NotifyDispatcher } from '../src/notifications/notify.dispatcher';

let dir: string;
let db: Db;
let sqlite: Database.Database;
let settings: SettingsService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homestock-reminder-'));
  db = createDb(join(dir, 'stock.db'));
  sqlite = (db as unknown as { $client: Database.Database }).$client;
  settings = new SettingsService(db);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 固定日期时钟：2026-11-06（周五） */
const TODAY = '2026-11-06';
const fixedClock = (today = TODAY) => ({
  today: () => today,
  now: () => new Date(`${today}T08:00:00`),
});

function insertItem(body: {
  name: string;
  expiryDate?: string | null;
  opened?: number;
  openedAt?: string | null;
  openShelfDays?: number | null;
  remindDays?: number | null;
  status?: string;
}): number {
  const r = sqlite
    .prepare(
      `INSERT INTO items (name, quantity, status, expiry_date, opened, opened_at, open_shelf_days, remind_days)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      body.name,
      body.status ?? 'active',
      body.expiryDate ?? null,
      body.opened ?? 0,
      body.openedAt ?? null,
      body.openShelfDays ?? null,
      body.remindDays ?? null,
    );
  return Number(r.lastInsertRowid);
}

function notificationsOf(itemId?: number) {
  const sql = itemId
    ? `SELECT * FROM notifications WHERE item_id = ? ORDER BY id`
    : `SELECT * FROM notifications ORDER BY id`;
  return (itemId ? sqlite.prepare(sql).all(itemId) : sqlite.prepare(sql).all()) as {
    id: number;
    item_id: number;
    type: string;
    sent_date: string;
    channels: string;
    read: number;
    created_at: string;
  }[];
}

function itemRow(id: number) {
  return sqlite.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as {
    status: string;
    archived_reason: string | null;
    archived_at: string | null;
  };
}

/** 真实派发器：只有 inapp 渠道（email/wecom 未启用 → skipped），用于验证去重与落库 */
async function realDispatcher() {
  const logs: { channel: string; level: string; message: string }[] = [];
  const d = new NotifyDispatcher([new InAppNotifier()], { log: (c, l, m) => logs.push({ channel: c, level: l, message: m }) });
  return { d, logs };
}

/** 记录型派发器：只观察判定结果，不落库 */
function recordingDispatcher() {
  const sent: { itemId: number; type: string; sentDate: string }[] = [];
  return {
    sent,
    dispatch: async (job: { itemId: number; type: string; sentDate: string }) => {
      sent.push({ itemId: job.itemId, type: job.type, sentDate: job.sentDate });
      return { inapp: { ok: true } };
    },
  };
}

describe('提醒判定（M3.1/M3.2/M3.4）', () => {
  it('距有效过期日 = 阈值当天 → expiring_soon 触发一次', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '牛奶', expiryDate: '2026-11-09' }); // +3 天，默认阈值 3
    const rec = recordingDispatcher();
    const svc = new ReminderService(db, settings, rec as never, fixedClock());
    await svc.run();
    expect(rec.sent).toEqual([{ itemId: id, type: 'expiring_soon', sentDate: TODAY }]);
  });

  it('阈值 +1 天（未进入窗口）→ 不提醒', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    insertItem({ name: '酸奶', expiryDate: '2026-11-10' }); // +4 天
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([]);
  });

  it('今日 = 有效过期日 → expired（M3.2：过期当天发“已过期”，即使临期已发过）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '面包', expiryDate: TODAY });
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([{ itemId: id, type: 'expired', sentDate: TODAY }]);
  });

  it('已过期（今日 > 过期日）→ expired', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '老酸奶', expiryDate: '2026-11-01' });
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([{ itemId: id, type: 'expired', sentDate: TODAY }]);
  });

  it('无有效过期日（长期存储品）→ 不提醒（M3.4）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    insertItem({ name: '白酒' });
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([]);
  });

  it('开封后按 开封日期+开封保质天数 重算有效过期日', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({
      name: '开了的果汁',
      expiryDate: '2027-01-01',
      opened: 1,
      openedAt: '2026-11-05',
      openShelfDays: 2, // 有效过期日 = 11-07 → 距今 1 天
    });
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([{ itemId: id, type: 'expiring_soon', sentDate: TODAY }]);
  });

  it('物品级 remind_days 覆盖全局默认（M6.3）；全局默认来自 settings（M6.2）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    await settings.update({ default_remind_days: 5 });
    const a = insertItem({ name: '按全局5天的药', expiryDate: '2026-11-10' }); // +4 → 命中 5
    const b = insertItem({ name: '单独1天的药', expiryDate: '2026-11-10', remindDays: 1 }); // +4 → 不命中 1
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([{ itemId: a, type: 'expiring_soon', sentDate: TODAY }]);
    expect(rec.sent.find((s) => s.itemId === b)).toBeUndefined();
  });

  it('已归档物品不参与扫描', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    insertItem({ name: '已用完的', expiryDate: TODAY, status: 'archived' });
    const rec = recordingDispatcher();
    await new ReminderService(db, settings, rec as never, fixedClock()).run();
    expect(rec.sent).toEqual([]);
  });
});

describe('去重（M3.3：重复扫描不重发）', () => {
  it('连续两次扫描：只产生 1 条通知；notifications 唯一约束兜底', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '牛奶', expiryDate: '2026-11-09' });
    const { d } = await realDispatcher();
    const svc = new ReminderService(db, settings, d, fixedClock());
    await svc.run();
    await svc.run();
    const rows = notificationsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'expiring_soon', sent_date: TODAY });
  });

  it('并发两次 runReminderScan → 不双发（brief 五类边界：并发重复）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '并发牛奶', expiryDate: '2026-11-09' });
    const { d } = await realDispatcher();
    const svc = new ReminderService(db, settings, d, fixedClock());
    await Promise.all([svc.run(), svc.run()]);
    expect(notificationsOf(id)).toHaveLength(1);
  });

  it('跨天扫描：同一物品同类型终身只发一次（不按天重发，评审裁定以 M3.1 为准）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '跨天牛奶', expiryDate: '2026-11-14' });
    const { d } = await realDispatcher();
    await new ReminderService(db, settings, d, fixedClock('2026-11-11')).run();
    await new ReminderService(db, settings, d, fixedClock('2026-11-12')).run();
    expect(notificationsOf(id)).toHaveLength(1);
  });

  it('关闭自动归档后多日扫描：expired 也只发一条（过期当天发，之后不再发）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    await settings.update({ auto_archive_expired: 0 });
    const id = insertItem({ name: '过期不打扰', expiryDate: '2026-11-10' });
    const { d } = await realDispatcher();
    for (const day of ['2026-11-10', '2026-11-11', '2026-11-12']) {
      await new ReminderService(db, settings, d, fixedClock(day)).run();
    }
    const rows = notificationsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'expired', sent_date: '2026-11-10' });
  });

  it('去重不依赖 inapp 渠道：inapp 关闭时，email 跨天也只发一次', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    await settings.update({ email: { enabled: 1, smtp_host: 'h', smtp_port: 465, secure: 1, from: 'f@x', to: 't@x' } });
    const id = insertItem({ name: 'inapp关闭也去重', expiryDate: '2026-11-14' });
    const emailCalls: string[] = [];
    const emailOnly = {
      name: 'email' as const,
      isEnabled: (s: { email: { enabled: number }; inapp: { enabled: number } }) => s.email.enabled === 1,
      send: async () => {
        emailCalls.push('sent');
        return { channel: 'email' as const, ok: true };
      },
    };
    const dispatcher = new NotifyDispatcher([emailOnly as never], { log: () => {} });
    await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-11')).run();
    await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-12')).run();
    expect(emailCalls).toHaveLength(1);
    // 注意：此处没有 inapp 渠道参与，去重仍生效
    expect(notificationsOf(id)).toHaveLength(1);
  });
});

describe('过期自动归档（M4.1/M4.2）', () => {
  it('开关开启且已过期 → 自动归档 expired_discarded，archived_at=今日，并写一条 expired 通知', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '过期酸奶', expiryDate: '2026-11-05' }); // 昨天过期
    const { d } = await realDispatcher();
    const svc = new ReminderService(db, settings, d, fixedClock());
    const res = await svc.run();
    expect(itemRow(id)).toMatchObject({ status: 'archived', archived_reason: 'expired_discarded', archived_at: TODAY });
    expect(notificationsOf(id)).toHaveLength(1);
    expect(notificationsOf(id)[0].type).toBe('expired');
    expect(res.archived).toBe(1);
  });

  it('过期当天不归档（次日才开始，M4.1“过期日次日起”）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '今天过期', expiryDate: TODAY });
    const { d } = await realDispatcher();
    const res = await new ReminderService(db, settings, d, fixedClock()).run();
    expect(itemRow(id)).toMatchObject({ status: 'active', archived_reason: null });
    expect(res.archived).toBe(0);
  });

  it('开关关闭 → 不归档，保留 active 并仍写 expired 通知（M4.2）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    await settings.update({ auto_archive_expired: 0 });
    const id = insertItem({ name: '过期面包', expiryDate: '2026-11-01' });
    const { d } = await realDispatcher();
    const svc = new ReminderService(db, settings, d, fixedClock());
    await svc.run();
    expect(itemRow(id)).toMatchObject({ status: 'active', archived_reason: null });
    expect(notificationsOf(id)).toHaveLength(1);
  });

  it('扫描 dispatch 窗口内物品被用户归档为 used_up → 扫描不得覆盖归档原因（M2 竞态）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '竞态牛奶', expiryDate: '2026-11-01' }); // 已过期
    // 模拟 dispatch await 窗口（邮件渠道可达 25s+）内，用户把物品手动归档为 used_up
    const racingDispatcher = {
      dispatch: async () => {
        sqlite
          .prepare(
            `UPDATE items SET status = 'archived', archived_reason = 'used_up', archived_at = ? WHERE id = ?`,
          )
          .run(TODAY, id);
        return { inapp: { ok: true } };
      },
    };
    const svc = new ReminderService(db, settings, racingDispatcher as never, fixedClock());
    const res = await svc.run();
    // 用户主动归档的 used_up 不得被扫描覆盖为 expired_discarded（否则浪费统计多计）
    expect(itemRow(id)).toMatchObject({ status: 'archived', archived_reason: 'used_up' });
    // 已被用户归档的物品不再计入本次自动归档
    expect(res.archived).toBe(0);
  });

  it('自动归档写入的 archived_at 与通知 sent_date 均取注入时钟（不依赖真实时间）', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '时钟验证', expiryDate: '2025-01-01' });
    const { d } = await realDispatcher();
    await new ReminderService(db, settings, d, fixedClock('2026-03-15')).run();
    expect(itemRow(id).archived_at).toBe('2026-03-15');
    expect(notificationsOf(id)[0].sent_date).toBe('2026-03-15');
    // created_at 同样取注入时钟（评审 Minor：InAppNotifier created_at 走注入时钟）
    expect(notificationsOf(id)[0].created_at).toBe('2026-03-15T08:00:00');
  });
});

describe('run 结果聚合（评审 Minor：channels 按物品聚合，不得只留最后一条）', () => {
  it('两条物品触发时，channels.inapp 记录 sent=2 而非只留最后一条', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    insertItem({ name: '聚合A', expiryDate: '2026-11-09' });
    insertItem({ name: '聚合B', expiryDate: '2026-11-08' });
    const { d } = await realDispatcher();
    const res = await new ReminderService(db, settings, d, fixedClock()).run();
    expect(res.channels.inapp).toMatchObject({ ok: true, sent: 2, failed: 0 });
  });
});

describe('失败重试（评审 R1：全渠道失败不得永久占用终身额度）', () => {
  function flakyEmail(state: { fail: boolean; calls: number }) {
    return {
      name: 'email' as const,
      isEnabled: () => true,
      send: async () => {
        state.calls += 1;
        return state.fail
          ? { channel: 'email' as const, ok: false, error: 'smtp down' }
          : { channel: 'email' as const, ok: true };
      },
    };
  }

  it('全渠道失败 → 释放额度，次日重试成功', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '重试品', expiryDate: '2026-11-14' });
    const state = { fail: true, calls: 0 };
    const dispatcher = new NotifyDispatcher([flakyEmail(state) as never], { log: () => {} });

    const day1 = await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-11')).run();
    expect(day1.notified).toBe(0);
    expect(notificationsOf(id)).toHaveLength(0); // 占位行已释放，终身额度未被占用

    state.fail = false;
    const day2 = await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-12')).run();
    expect(state.calls).toBe(2); // 次日确实重试
    expect(day2.notified).toBe(1);
    expect(notificationsOf(id)).toHaveLength(1);
    expect(notificationsOf(id)[0]).toMatchObject({ type: 'expiring_soon', sent_date: '2026-11-12' });
  });

  it('部分渠道成功 → 视为已送达，不再重试', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '部分成功品', expiryDate: '2026-11-14' });
    const state = { fail: false, calls: 0 };
    const badWecom = {
      name: 'wecom' as const,
      isEnabled: () => true,
      send: async () => ({ channel: 'wecom' as const, ok: false, error: 'wecom boom' }),
    };
    const dispatcher = new NotifyDispatcher([flakyEmail(state) as never, badWecom as never], { log: () => {} });

    const day1 = await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-11')).run();
    expect(day1.notified).toBe(1);
    expect(day1.channels.email).toMatchObject({ ok: true, sent: 1 });
    expect(day1.channels.wecom).toMatchObject({ ok: false, failed: 1 });

    await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-12')).run();
    expect(state.calls).toBe(1); // 不重试
    expect(notificationsOf(id)).toHaveLength(1);
  });

  it('全部 skipped（无渠道启用）→ 不算失败、不重试', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '无渠道品', expiryDate: '2026-11-14' });
    const disabled = { name: 'email' as const, isEnabled: () => false, send: vi.fn() };
    const dispatcher = new NotifyDispatcher([disabled as never], { log: () => {} });

    const day1 = await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-11')).run();
    expect(day1.notified).toBe(0);
    expect(notificationsOf(id)).toHaveLength(1); // 占位保留：不重试也不每天刷记录

    await new ReminderService(db, settings, dispatcher, fixedClock('2026-11-12')).run();
    expect(disabled.send).not.toHaveBeenCalled();
    expect(notificationsOf(id)).toHaveLength(1);
  });
});

describe('依赖失败韧性（M3.5 / 第 9 节）', () => {
  it('邮件/企微渠道抛错不影响 inapp 落库，失败写 notification_logs', async () => {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const id = insertItem({ name: '韧性牛奶', expiryDate: '2026-11-09' });
    const failing = {
      name: 'email' as const,
      isEnabled: () => true,
      send: async () => {
        throw new Error('SMTP down');
      },
    };
    const logs: { channel: string; level: string; message: string }[] = [];
    const dispatcher = new NotifyDispatcher([new InAppNotifier(), failing as never], {
      log: (c, l, m) => logs.push({ channel: c, level: l, message: m }),
    });
    const svc = new ReminderService(db, settings, dispatcher, fixedClock());
    const res = await svc.run();
    expect(notificationsOf(id)).toHaveLength(1);
    expect(res.channels.email).toMatchObject({ ok: false });
    expect(logs.some((l) => l.channel === 'email' && l.level === 'error')).toBe(true);
  });
});
