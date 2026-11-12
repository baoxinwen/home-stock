/**
 * Task5 RED — Notifier 渠道抽象、三渠道实现、派发隔离。
 * 单元测试：不启 HTTP，直接构造 notifier/dispatcher（mock transport / mock fetch / fake timers）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { createDb, type Db } from '../src/db';
import { notifierSettings } from './fixtures';

let dir: string;
let db: Db;
let sqlite: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homestock-notify-'));
  db = createDb(join(dir, 'stock.db'));
  sqlite = (db as unknown as { $client: Database.Database }).$client;
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertItem(name = '牛奶'): number {
  const r = sqlite.prepare(`INSERT INTO items (name, quantity, status) VALUES (?, 1, 'active')`).run(name);
  return Number(r.lastInsertRowid);
}

function job(overrides: Partial<Parameters<typeof makeJob>[0]> = {}) {
  return makeJob({ itemId: insertItem(), itemName: '牛奶', type: 'expiring_soon', sentDate: '2026-11-06', ...overrides });
}

function makeJob(o: { itemId: number; itemName: string; type: 'expiring_soon' | 'expired'; sentDate: string }) {
  return {
    itemId: o.itemId,
    itemName: o.itemName,
    type: o.type,
    sentDate: o.sentDate,
    title: `${o.itemName} 临期提醒`,
    body: '牛奶将于 2026-11-08 过期',
  };
}

describe('InAppNotifier（评审 Important 2：去重从 inapp 渠道解耦）', () => {
  it('不再自己写 notifications 表（去重/记录归 NotificationLedger），只报告渠道可用', async () => {
    const { InAppNotifier } = await import('../src/notifications/inapp.notifier');
    const n = new InAppNotifier();
    const r = await n.send(job(), notifierSettings({}));
    expect(r).toMatchObject({ channel: 'inapp', ok: true });
    const rows = sqlite.prepare(`SELECT * FROM notifications`).all();
    expect(rows).toHaveLength(0);
  });

  it('isEnabled 跟随 settings（inapp 默认启用）', async () => {
    const { InAppNotifier } = await import('../src/notifications/inapp.notifier');
    const n = new InAppNotifier();
    expect(n.isEnabled(notifierSettings({}))).toBe(true);
    expect(n.isEnabled(notifierSettings({ inappEnabled: false }))).toBe(false);
  });
});

describe('NotificationLedger（去重权威，独立于渠道）', () => {
  it('reserve 幂等：同 (item,type,sent_date) 第二次返回 false，且只落一行', async () => {
    const { NotificationLedger } = await import('../src/notifications/notification-ledger');
    const ledger = new NotificationLedger(db);
    const itemId = insertItem();
    expect(ledger.reserve(itemId, 'expiring_soon', '2026-11-06')).toBe(true);
    expect(ledger.reserve(itemId, 'expiring_soon', '2026-11-06')).toBe(false);
    expect(sqlite.prepare(`SELECT * FROM notifications WHERE item_id = ?`).all(itemId)).toHaveLength(1);
  });

  it('hasAny 跨日期判存在（终身一次），不同类型互不影响', async () => {
    const { NotificationLedger } = await import('../src/notifications/notification-ledger');
    const ledger = new NotificationLedger(db);
    const itemId = insertItem();
    ledger.reserve(itemId, 'expiring_soon', '2026-11-06');
    expect(ledger.hasAny(itemId, 'expiring_soon')).toBe(true);
    expect(ledger.hasAny(itemId, 'expired')).toBe(false);
  });

  it('created_at 取注入时钟', async () => {
    const { NotificationLedger } = await import('../src/notifications/notification-ledger');
    const fixed = { today: () => '2026-03-15', now: () => new Date('2026-03-15T09:30:00') };
    const ledger = new NotificationLedger(db, fixed);
    const itemId = insertItem();
    ledger.reserve(itemId, 'expired', '2026-03-15');
    const row = sqlite.prepare(`SELECT created_at FROM notifications WHERE item_id = ?`).get(itemId) as {
      created_at: string;
    };
    expect(row.created_at).toBe('2026-03-15T09:30:00');
  });

  it('recordChannels 回写各渠道结果；多条物品各自独立', async () => {
    const { NotificationLedger } = await import('../src/notifications/notification-ledger');
    const ledger = new NotificationLedger(db);
    const a = insertItem();
    const b = insertItem();
    ledger.reserve(a, 'expiring_soon', '2026-11-06');
    ledger.reserve(b, 'expiring_soon', '2026-11-06');
    ledger.recordChannels(a, 'expiring_soon', '2026-11-06', { inapp: { ok: true } });
    ledger.recordChannels(b, 'expiring_soon', '2026-11-06', { inapp: { ok: false, error: 'x' } });
    const rows = sqlite.prepare(`SELECT item_id, channels FROM notifications ORDER BY item_id`).all() as {
      item_id: number;
      channels: string;
    }[];
    expect(rows[0].channels).toContain('"ok":true');
    expect(rows[1].channels).toContain('"error":"x"');
  });
});

describe('EmailNotifier', () => {
  it('启用时按配置组装邮件并调用 transport（mock transport 断言载荷）', async () => {
    const { EmailNotifier } = await import('../src/notifications/email.notifier');
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const close = vi.fn();
    const createTransport = vi.fn(() => ({ sendMail, close }));
    const n = new EmailNotifier(createTransport as never);
    const settings = notifierSettings({
      email: { enabled: 1, smtp_host: 'smtp.qq.com', smtp_port: 465, secure: 1, user: 'a@qq.com', pass: 'p', from: 'a@qq.com', to: 'b@qq.com' },
    });

    const j = job();
    const r = await n.send(j, settings);
    expect(r).toMatchObject({ channel: 'email', ok: true });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.qq.com', port: 465, secure: true, auth: { user: 'a@qq.com', pass: 'p' } }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'a@qq.com', to: 'b@qq.com', subject: j.title, text: j.body }),
    );
  });

  it('未启用 → skipped，不创建 transport', async () => {
    const { EmailNotifier } = await import('../src/notifications/email.notifier');
    const createTransport = vi.fn();
    const n = new EmailNotifier(createTransport as never);
    const r = await n.send(job(), notifierSettings({}));
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('SMTP 抛错 → ok:false 且带 error，不抛出（依赖失败不崩溃）', async () => {
    const { EmailNotifier } = await import('../src/notifications/email.notifier');
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:465')),
      close: vi.fn(),
    }));
    const n = new EmailNotifier(createTransport as never);
    const r = await n.send(
      job(),
      notifierSettings({
        email: { enabled: 1, smtp_host: 'smtp.qq.com', smtp_port: 465, secure: 1, user: 'a@qq.com', pass: 'p', from: 'a@qq.com', to: 'b@qq.com' },
      }),
    );
    expect(r).toMatchObject({ channel: 'email', ok: false });
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('配置缺失（无 host/to）→ ok:false 明确报错，不发起网络请求（空输入边界）', async () => {
    const { EmailNotifier } = await import('../src/notifications/email.notifier');
    const createTransport = vi.fn();
    const n = new EmailNotifier(createTransport as never);
    const r = await n.send(job(), notifierSettings({ email: { enabled: 1 } as never }));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe('WecomNotifier', () => {
  const wecomSettings = (over: Record<string, unknown> = {}) =>
    notifierSettings({
      wecom: { enabled: 1, corp_id: 'corp1', agent_id: '1000002', secret: 'sec', to_user: '@all', ...over },
    });

  it('先取 access_token 再发 text 消息；断言 URL 与载荷', async () => {
    const { WecomNotifier } = await import('../src/notifications/wecom.notifier');
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url).includes('/gettoken')) {
        return new Response(JSON.stringify({ errcode: 0, access_token: 'TOKEN1', expires_in: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
    });
    const n = new WecomNotifier(fakeFetch as never);
    const r = await n.send(job(), wecomSettings());
    expect(r).toMatchObject({ channel: 'wecom', ok: true });

    expect(calls[0].url).toContain('qyapi.weixin.qq.com/cgi-bin/gettoken');
    expect(calls[0].url).toContain('corpid=corp1');
    expect(calls[0].url).toContain('corpsecret=sec');
    expect(calls[1].url).toContain('/message/send?access_token=TOKEN1');
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body).toMatchObject({ touser: '@all', msgtype: 'text', agentid: 1000002 });
    expect(body.text.content).toContain('牛奶');
  });

  it('access_token 内存缓存：第二次发送不再请求 gettoken；过期后（fake timers 推进）重新获取', async () => {
    vi.useFakeTimers();
    try {
      const { WecomNotifier } = await import('../src/notifications/wecom.notifier');
      let tokenSeq = 0;
      const getTokenCalls = () => tokenSeq;
      const fakeFetch = vi.fn(async (url: string) => {
        if (String(url).includes('/gettoken')) {
          tokenSeq += 1;
          return new Response(JSON.stringify({ errcode: 0, access_token: `TOKEN${tokenSeq}`, expires_in: 7200 }), { status: 200 });
        }
        return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
      });
      const n = new WecomNotifier(fakeFetch as never);
      const s = wecomSettings();

      await n.send(job(), s);
      expect(getTokenCalls()).toBe(1);
      await n.send(job(), s);
      expect(getTokenCalls()).toBe(1); // 命中缓存

      // 推进超过 7200-120 秒 → 缓存失效，重新获取
      vi.advanceTimersByTime((7200 + 1) * 1000);
      const before = Date.now();
      vi.setSystemTime(before);
      await n.send(job(), s);
      expect(getTokenCalls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('企微返回 errcode≠0 → ok:false + 错误信息（依赖失败不崩溃）', async () => {
    const { WecomNotifier } = await import('../src/notifications/wecom.notifier');
    const fakeFetch = vi.fn(async (url: string) => {
      if (String(url).includes('/gettoken')) {
        return new Response(JSON.stringify({ errcode: 40001, errmsg: 'invalid credential' }), { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    });
    const n = new WecomNotifier(fakeFetch as never);
    const r = await n.send(job(), wecomSettings());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('40001');
  });

  it('网络异常（fetch reject）→ ok:false 不抛出', async () => {
    const { WecomNotifier } = await import('../src/notifications/wecom.notifier');
    const n = new WecomNotifier(vi.fn().mockRejectedValue(new Error('ENOTFOUND qyapi.weixin.qq.com')) as never);
    const r = await n.send(job(), wecomSettings());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ENOTFOUND');
  });

  it('未启用 → skipped', async () => {
    const { WecomNotifier } = await import('../src/notifications/wecom.notifier');
    const fakeFetch = vi.fn();
    const n = new WecomNotifier(fakeFetch as never);
    const r = await n.send(job(), notifierSettings({}));
    expect(r.skipped).toBe(true);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe('NotifyDispatcher 派发隔离', () => {
  it('一个渠道抛错，其他渠道仍收到；失败写 notification_logs', async () => {
    const { NotifyDispatcher } = await import('../src/notifications/notify.dispatcher');
    const okChannel = {
      name: 'email' as const,
      isEnabled: () => true,
      send: vi.fn().mockResolvedValue({ channel: 'email' as const, ok: true }),
    };
    const boom = {
      name: 'wecom' as const,
      isEnabled: () => true,
      send: vi.fn().mockRejectedValue(new Error('boom channel')),
    };
    const logs: { channel: string; level: string; message: string }[] = [];
    const d = new NotifyDispatcher([boom, okChannel], { log: (c, l, m) => logs.push({ channel: c, level: l, message: m }) });
    const results = await d.dispatch(job(), notifierSettings({}));
    expect(okChannel.send).toHaveBeenCalled();
    expect(results.wecom).toMatchObject({ ok: false });
    expect(results.email).toMatchObject({ ok: true });
    expect(logs.length).toBe(1);
    expect(logs[0]).toMatchObject({ channel: 'wecom', level: 'error' });
  });

  it('未启用的渠道不调用 send', async () => {
    const { NotifyDispatcher } = await import('../src/notifications/notify.dispatcher');
    const disabled = {
      name: 'wecom' as const,
      isEnabled: () => false,
      send: vi.fn(),
    };
    const d = new NotifyDispatcher([disabled], { log: () => {} });
    const results = await d.dispatch(job(), notifierSettings({}));
    expect(disabled.send).not.toHaveBeenCalled();
    expect(results.wecom).toMatchObject({ ok: true, skipped: true });
  });

  it('派发器不承担去重：各启用渠道都会收到（去重由 NotificationLedger 在上游完成）', async () => {
    const { NotifyDispatcher } = await import('../src/notifications/notify.dispatcher');
    const inapp = { name: 'inapp' as const, isEnabled: () => true, send: vi.fn().mockResolvedValue({ channel: 'inapp' as const, ok: true }) };
    const email = { name: 'email' as const, isEnabled: () => true, send: vi.fn().mockResolvedValue({ channel: 'email' as const, ok: true }) };
    const d = new NotifyDispatcher([inapp, email], { log: () => {} });
    const results = await d.dispatch(job(), notifierSettings({}));
    expect(email.send).toHaveBeenCalled();
    expect(results.inapp).toMatchObject({ ok: true });
    expect(results.email).toMatchObject({ ok: true });
  });
});

describe('notification_logs 保留上限（评审 M6：三处写入路径只插不清 → 无限膨胀）', () => {
  function logRows(): { id: number; message: string }[] {
    return sqlite.prepare(`SELECT id, message FROM notification_logs ORDER BY id`).all() as {
      id: number;
      message: string;
    }[];
  }

  it('NotificationsService.log 写入超上限后，旧日志被清理且保留最新 500 条', async () => {
    const { NotificationsService } = await import('../src/notifications/notifications.service');
    const svc = new NotificationsService(db);
    for (let i = 1; i <= 505; i += 1) {
      svc.log('email', 'error', `msg-${i}`);
    }
    const rows = logRows();
    expect(rows).toHaveLength(500);
    // 最旧的 5 条（msg-1..msg-5）被清掉，保留的是最新 500 条
    expect(rows[0].message).toBe('msg-6');
    expect(rows[rows.length - 1].message).toBe('msg-505');
  });

  it('未超上限时不删任何行', async () => {
    const { NotificationsService } = await import('../src/notifications/notifications.service');
    const svc = new NotificationsService(db);
    for (let i = 1; i <= 10; i += 1) {
      svc.log('scheduler', 'info', `keep-${i}`);
    }
    const rows = logRows();
    expect(rows).toHaveLength(10);
    expect(rows[0].message).toBe('keep-1');
  });
});
