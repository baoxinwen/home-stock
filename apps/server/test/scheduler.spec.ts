/**
 * Task5 RED — 调度器（node-cron 每日扫描）与手动触发/测试发送 API。
 * 规格 M6.1（提醒时刻来自设置、变更后重建任务）、M7.1/M7.2（测试发送）、第 9 节（调度异常不崩溃）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import request from 'supertest';
import { createDb, type Db } from '../src/db';
import { SettingsService } from '../src/settings/settings.service';

let dir: string;
let db: Db;
let sqlite: Database.Database;
let settings: SettingsService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homestock-sched-'));
  db = createDb(join(dir, 'stock.db'));
  sqlite = (db as unknown as { $client: Database.Database }).$client;
  settings = new SettingsService(db);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function fakeCron() {
  const scheduled: { expr: string; opts?: { timezone?: string }; stopped: boolean; fn: () => void }[] = [];
  return {
    scheduled,
    schedule(expr: string, fn: () => void, opts?: { timezone?: string }) {
      const task = {
        expr,
        opts,
        stopped: false,
        fn,
        stop() {
          this.stopped = true;
        },
      };
      scheduled.push(task);
      return task;
    },
  };
}

describe('ReminderScheduler', () => {
  it('启动时按 settings.reminder_hour 注册每日任务（默认 8 点）', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    const cron = fakeCron();
    const reminders = { run: vi.fn().mockResolvedValue({ notified: 0, archived: 0, channels: {} }) };
    const s = new ReminderScheduler(reminders as never, settings, cron as never);
    await s.rebuild();
    expect(cron.scheduled).toHaveLength(1);
    expect(cron.scheduled[0].expr).toBe('0 8 * * *');
  });

  it('settings 变更 reminder_hour → 重建任务（旧任务停止，新表达式生效）', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    const cron = fakeCron();
    const reminders = { run: vi.fn().mockResolvedValue({ notified: 0, archived: 0, channels: {} }) };
    const s = new ReminderScheduler(reminders as never, settings, cron as never);
    await s.rebuild();
    await settings.update({ reminder_hour: 20 });
    // settings.update 通过进程内事件总线通知调度器
    await new Promise((r) => setTimeout(r, 10));
    expect(cron.scheduled).toHaveLength(2);
    expect(cron.scheduled[0].stopped).toBe(true);
    expect(cron.scheduled[1].expr).toBe('0 20 * * *');
    s.stop();
  });

  it('非法 hour（库里被改成 99）→ 回退 8 点，不崩溃', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    sqlite.prepare(`UPDATE settings SET value = '99' WHERE key = 'reminder_hour'`).run();
    const cron = fakeCron();
    const reminders = { run: vi.fn() };
    const s = new ReminderScheduler(reminders as never, settings, cron as never);
    await s.rebuild();
    expect(cron.scheduled[0].expr).toBe('0 8 * * *');
  });

  it('触发回调里扫描异常被捕获并记日志，不抛出', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    const cron = fakeCron();
    const reminders = { run: vi.fn().mockRejectedValue(new Error('scan boom')) };
    const logs: { channel: string; level: string; message: string }[] = [];
    const s = new ReminderScheduler(reminders as never, settings, cron as never, { log: (c, l, m) => logs.push({ channel: c, level: l, message: m }) });
    await s.rebuild();
    await cron.scheduled[0].fn();
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.some((l) => l.level === 'error' && l.message.includes('scan boom'))).toBe(true);
  });

  it('onModuleDestroy 停止任务', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    const cron = fakeCron();
    const s = new ReminderScheduler({ run: vi.fn() } as never, settings, cron as never);
    await s.rebuild();
    s.onModuleDestroy();
    expect(cron.scheduled[0].stopped).toBe(true);
  });
});

describe('重启补跑（M5：容器跨过提醒时刻重启的当天不漏提醒）', () => {
  /** 固定时刻时钟：ISO 形如 2026-11-07T09:00:00 */
  const fixedClock = (iso: string) => ({
    today: () => iso.slice(0, 10),
    now: () => new Date(iso),
  });

  function insertExpiredItem(name: string): number {
    const r = sqlite
      .prepare(`INSERT INTO items (name, quantity, status, expiry_date) VALUES (?, 1, 'active', '2026-11-05')`)
      .run(name);
    return Number(r.lastInsertRowid);
  }

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

  async function makeService(clockIso: string) {
    const { ReminderService } = await import('../src/reminders/reminder.service');
    const rec = recordingDispatcher();
    const svc = new ReminderService(db, settings, rec as never, fixedClock(clockIso));
    return { svc, rec };
  }

  async function logsOf() {
    return sqlite
      .prepare(`SELECT channel, level, message FROM notification_logs WHERE channel = 'scheduler' ORDER BY id`)
      .all() as { channel: string; level: string; message: string }[];
  }

  it('昨日未跑 + 已过今日提醒时刻 → onModuleInit 立即补扫一次并写入当日', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    const id = insertExpiredItem('补跑牛奶');
    const { svc, rec } = await makeService('2026-11-07T09:00:00'); // 9 点 ≥ reminder_hour 8
    await settings.setReminderLastRunDate('2026-11-06'); // 昨天跑过（或没跑成），今天尚未跑
    const logs: { channel: string; level: string; message: string }[] = [];
    const s = new ReminderScheduler(svc as never, settings, fakeCron() as never, { log: (c, l, m) => logs.push({ channel: c, level: l, message: m }) }, fixedClock('2026-11-07T09:00:00'));

    await s.onModuleInit();

    expect(rec.sent).toEqual([{ itemId: id, type: 'expired', sentDate: '2026-11-07' }]);
    expect(await settings.getReminderLastRunDate()).toBe('2026-11-07');
    // 补跑留可观察日志
    expect(logs.some((l) => l.level === 'info' && l.message.includes('补'))).toBe(true);
  });

  it('今日已跑（last_run_date=今天）→ 不补扫', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    insertExpiredItem('今日已跑牛奶');
    const { svc, rec } = await makeService('2026-11-07T09:00:00');
    await settings.setReminderLastRunDate('2026-11-07');
    const s = new ReminderScheduler(svc as never, settings, fakeCron() as never, undefined, fixedClock('2026-11-07T09:00:00'));

    await s.onModuleInit();

    expect(rec.sent).toEqual([]);
  });

  it('尚未到今日提醒时刻（07:00 < 8 点）→ 不补扫，交给当日 cron', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    insertExpiredItem('未到时刻牛奶');
    const { svc, rec } = await makeService('2026-11-07T07:00:00');
    await settings.setReminderLastRunDate('2026-11-06');
    const s = new ReminderScheduler(svc as never, settings, fakeCron() as never, undefined, fixedClock('2026-11-07T07:00:00'));

    await s.onModuleInit();

    expect(rec.sent).toEqual([]);
  });

  it('last_run_date 缺失（首次启动）且已过今日时刻 → 也补扫一次', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    insertExpiredItem('首次启动牛奶');
    const { svc, rec } = await makeService('2026-11-07T20:00:00');
    const s = new ReminderScheduler(svc as never, settings, fakeCron() as never, undefined, fixedClock('2026-11-07T20:00:00'));

    await s.onModuleInit();

    expect(rec.sent).toHaveLength(1);
    expect(await settings.getReminderLastRunDate()).toBe('2026-11-07');
  });

  it('补跑同样受终身一次去重保护：重启两次不重发', async () => {
    const { ReminderScheduler } = await import('../src/reminders/reminder.scheduler');
    insertExpiredItem('重启两次牛奶');
    const { svc, rec } = await makeService('2026-11-07T09:00:00');
    await settings.setReminderLastRunDate('2026-11-06');
    const clock = fixedClock('2026-11-07T09:00:00');
    const s = new ReminderScheduler(svc as never, settings, fakeCron() as never, undefined, clock);

    await s.onModuleInit();
    // 模拟进程再次启动（同一天、上次补跑已成功写入当日）
    await settings.setReminderLastRunDate('2026-11-07');
    const s2 = new ReminderScheduler(svc as never, settings, fakeCron() as never, undefined, clock);
    await s2.onModuleInit();

    expect(rec.sent).toHaveLength(1);
  });
});

describe('提醒/测试发送 HTTP API', () => {
  let app: import('@nestjs/common').INestApplication;
  let appCtx: import('./helpers').TestCtx;

  beforeEach(async () => {
    const { startTestApp } = await import('./helpers');
    appCtx = await startTestApp();
    app = appCtx.app;
  });

  afterEach(async () => {
    const { stopTestApp } = await import('./helpers');
    await stopTestApp(appCtx);
  });

  it('POST /api/reminders/run 手动触发扫描（inapp 渠道落库）', async () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const soon = new Date(today.getTime() + 2 * 86400000);
    const created = await request(app.getHttpServer())
      .post('/api/items')
      .send({ name: '手动触发牛奶', expiryDate: iso(soon) });
    expect(created.status).toBe(201);

    const res = await request(app.getHttpServer()).post('/api/reminders/run').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ notified: expect.any(Number), archived: expect.any(Number) });
    expect(res.body.data.channels.inapp).toMatchObject({ ok: true, sent: expect.any(Number), failed: expect.any(Number) });

    const notifications = await request(app.getHttpServer()).get('/api/notifications');
    expect(notifications.body.data.some((n: { itemId: number }) => n.itemId === created.body.data.id)).toBe(true);

    // 再跑一次：不重复生成
    const res2 = await request(app.getHttpServer()).post('/api/reminders/run').send({});
    expect(res2.body.data.notified).toBe(0);
  });

  it('POST /api/settings/notify-test 指定渠道发测试消息；未知渠道 → 400', async () => {
    const ok = await request(app.getHttpServer()).post('/api/settings/notify-test').send({ channel: 'inapp' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.results.inapp).toMatchObject({ ok: true });

    const bad = await request(app.getHttpServer()).post('/api/settings/notify-test').send({ channel: 'sms' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
  });

  it('notify-test 不污染通知中心（评审 Important 3：测试消息不写 notifications）', async () => {
    const before = await request(app.getHttpServer()).get('/api/notifications');
    await request(app.getHttpServer()).post('/api/settings/notify-test').send({ channel: 'inapp' });
    const after = await request(app.getHttpServer()).get('/api/notifications');
    expect(after.body.data).toHaveLength(before.body.data.length);
    expect(after.body.unreadCount).toBe(before.body.unreadCount);
  });

  it('notify-test 写一条 info 级别的 notification_logs 作为可观察证据（评审 R3）', async () => {
    await request(app.getHttpServer()).post('/api/settings/notify-test').send({ channel: 'inapp' });
    const logs = await request(app.getHttpServer()).get('/api/notifications/logs');
    const infoLog = logs.body.data.find(
      (l: { channel: string; level: string }) => l.channel === 'inapp' && l.level === 'info',
    );
    expect(infoLog).toBeDefined();
    expect(infoLog.message).toContain('测试');
  });

  it('POST /api/settings/notify-test 邮件渠道未配置 → ok:false 且写失败日志（不崩）', async () => {
    const res = await request(app.getHttpServer()).post('/api/settings/notify-test').send({ channel: 'email' });
    expect(res.status).toBe(201);
    expect(res.body.data.results.email.ok).toBe(false);
    const logs = await request(app.getHttpServer()).get('/api/notifications/logs');
    expect(logs.body.data.some((l: { channel: string }) => l.channel === 'email')).toBe(true);
  });
});
