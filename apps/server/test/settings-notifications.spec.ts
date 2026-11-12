/**
 * Task5 RED — settings 模块与 notifications 模块 API 集成测试。
 * 覆盖 brief：GET/PUT settings 白名单校验、秘密脱敏、items 接 settings.default_remind_days、
 * notifications 列表/未读/标记已读、notification_logs 展示。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';

let ctx: TestCtx;

beforeAll(async () => {
  ctx = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(ctx);
});

const get = (url: string) => request(ctx.app.getHttpServer()).get(url);
const post = (url: string, body?: unknown) => request(ctx.app.getHttpServer()).post(url).send(body ?? {});
const put = (url: string, body?: unknown) => request(ctx.app.getHttpServer()).put(url).send(body ?? {});

describe('GET /api/settings', () => {
  it('返回默认设置（未配置时 default_remind_days=3, reminder_hour=8, auto_archive=1）', async () => {
    const res = await get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      default_remind_days: 3,
      reminder_hour: 8,
      auto_archive_expired: 1,
    });
    expect(res.body.data.email).toMatchObject({ enabled: 0, pass: null });
    expect(res.body.data.wecom).toMatchObject({ enabled: 0, secret: null });
  });
});

describe('PUT /api/settings', () => {
  it('更新基本设置并回读', async () => {
    const res = await put('/api/settings', {
      default_remind_days: 5,
      reminder_hour: 20,
      auto_archive_expired: 0,
    });
    expect(res.status).toBe(200);
    const got = await get('/api/settings');
    expect(got.body.data).toMatchObject({
      default_remind_days: 5,
      reminder_hour: 20,
      auto_archive_expired: 0,
    });
  });

  it('reminder_hour=25 → 400 非法（brief 五类边界）', async () => {
    const res = await put('/api/settings', { reminder_hour: 25 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('default_remind_days=0 → 400；超大值 3650 接受（极值）', async () => {
    const bad = await put('/api/settings', { default_remind_days: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    const big = await put('/api/settings', { default_remind_days: 3650 });
    expect(big.status).toBe(200);
    // 还原
    await put('/api/settings', { default_remind_days: 5 });
  });

  it('auto_archive_expired 仅接受 0/1', async () => {
    const res = await put('/api/settings', { auto_archive_expired: 2 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('秘密字段写入后 GET 脱敏为 ***；PUT 传 *** 保持原值', async () => {
    const put1 = await put('/api/settings', {
      email: { enabled: 1, smtp_host: 'smtp.qq.com', smtp_port: 465, secure: 1, user: 'a@qq.com', pass: 'secret123', from: 'a@qq.com', to: 'b@qq.com' },
      wecom: { enabled: 1, corp_id: 'corp1', agent_id: '1000002', secret: 'wecom-secret-xyz', to_user: '@all' },
    });
    expect(put1.status).toBe(200);
    const got = await get('/api/settings');
    expect(got.body.data.email.pass).toBe('***');
    expect(got.body.data.email.smtp_host).toBe('smtp.qq.com');
    expect(got.body.data.wecom.secret).toBe('***');
    expect(got.body.data.wecom.corp_id).toBe('corp1');

    // 传 *** → 保持原值（不覆盖为字面 "***"）
    const put2 = await put('/api/settings', { email: { smtp_host: 'smtp.163.com', pass: '***' } });
    expect(put2.status).toBe(200);
    const got2 = await get('/api/settings');
    expect(got2.body.data.email.smtp_host).toBe('smtp.163.com');
    expect(got2.body.data.email.pass).toBe('***');

    // 直查 DB 验证库里保存的是原值而非 "***"
    const row = ctx.sqlite.prepare(`SELECT value FROM settings WHERE key = 'email.pass'`).get() as { value: string };
    expect(row.value).toBe('secret123');
  });

  it('数值型设置回读为 number（smtp_port 不能返回字符串 "465"）', async () => {
    await put('/api/settings', { email: { smtp_port: 465, enabled: 1 } });
    const got = await get('/api/settings');
    expect(got.body.data.email.smtp_port).toBe(465);
    expect(typeof got.body.data.email.smtp_port).toBe('number');
    expect(typeof got.body.data.email.enabled).toBe('number');
    expect(typeof got.body.data.default_remind_days).toBe('number');
  });

  it('未知白名单外字段被忽略（不报错不落库）', async () => {
    const res = await put('/api/settings', { hacker_key: 'x', email: { enabled: 0 } });
    expect(res.status).toBe(200);
    const row = ctx.sqlite.prepare(`SELECT COUNT(*) AS c FROM settings WHERE key = 'hacker_key'`).get() as { c: number };
    expect(row.c).toBe(0);
  });

  it('email.smtp_port 非法（负数/非整数）→ 400', async () => {
    const res = await put('/api/settings', { email: { smtp_port: -1 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('items 接 settings.default_remind_days（M6.2）', () => {
  it('全局阈值改 5：无 remind_days 物品 expiryStatus 按 5 天判定；物品级 remind_days 优先（M6.3）', async () => {
    // 当前全局 default_remind_days=5
    // 距今 4 天 → 按默认阈值 5 应为 expiring
    const d4 = new Date();
    d4.setDate(d4.getDate() + 4);
    const iso4 = d4.toISOString().slice(0, 10);
    const a = await post('/api/items', { name: '阈值测试_全局_牛奶', expiryDate: iso4 });
    expect(a.body.data.expiryStatus).toBe('expiring');

    // 物品级 remind_days=1 覆盖全局：同日期 4 天后 → ok
    const b = await post('/api/items', { name: '阈值测试_覆盖_药', expiryDate: iso4, remindDays: 1 });
    expect(b.body.data.expiryStatus).toBe('ok');
  });
});

describe('notifications API', () => {
  async function insertNotification(itemId: number | null, type: string, sentDate: string, read = 0) {
    ctx.sqlite
      .prepare(`INSERT INTO notifications (item_id, type, sent_date, channels, read, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(itemId, type, sentDate, '{}', read, new Date().toISOString().slice(0, 19));
  }

  it('GET /api/notifications 列表 + unread=1 过滤', async () => {
    await insertNotification(null, 'expiring_soon', '2026-11-01', 0);
    await insertNotification(null, 'expired', '2026-11-02', 1);
    const all = await get('/api/notifications');
    expect(all.status).toBe(200);
    const unread = await get('/api/notifications?unread=1');
    expect(unread.body.data.every((n: { read: number }) => n.read === 0)).toBe(true);
  });

  it('POST /api/notifications/read 标记指定 ids 已读；无 ids 全部已读；重复调用幂等', async () => {
    await insertNotification(null, 'expiring_soon', '2026-11-03', 0);
    await insertNotification(null, 'expired', '2026-11-04', 0);
    const list1 = await get('/api/notifications?unread=1');
    const ids = list1.body.data.map((n: { id: number }) => n.id);
    const res = await post('/api/notifications/read', { ids: [ids[0]] });
    expect(res.status).toBe(200);
    const unreadAfter = await get('/api/notifications?unread=1');
    expect(unreadAfter.body.data.every((n: { id: number }) => n.id !== ids[0])).toBe(true);

    const all = await post('/api/notifications/read', {});
    expect(all.status).toBe(200);
    const none = await get('/api/notifications?unread=1');
    expect(none.body.data).toEqual([]);
  });

  it('GET /api/notifications/logs 返回失败日志列表', async () => {
    ctx.sqlite
      .prepare(`INSERT INTO notification_logs (channel, level, message, created_at) VALUES (?, ?, ?, ?)`)
      .run('email', 'error', 'SMTP connect failed', '2026-11-06T10:00:00');
    const res = await get('/api/notifications/logs');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toMatchObject({ channel: 'email', level: 'error' });
  });
});

describe('PUT /api/settings 事务性（M9：多键写入不得留半更新）', () => {
  /**
   * 构造「第 N 次写操作（insert/update/delete）抛错」的 db 代理。
   * 兼容两种写法：裸 this.db 直写（当前实现）与 this.db.transaction 回调内的 tx
   * （修复后实现）——两种路径共享同一写计数器，保证 RED/GREEN 阶段都会在第 2 次写失败。
   */
  function flakyDb(base: import('../src/db').Db, failOnWrite: number): import('../src/db').Db {
    let writes = 0;
    const maybeFail = (): void => {
      writes += 1;
      if (writes === failOnWrite) throw new Error('simulated db failure');
    };
    const wrapWriter =
      (orig: (...args: unknown[]) => unknown) =>
      (...args: unknown[]): unknown => {
        maybeFail();
        return orig(...args);
      };
    const wrapWriterProp = (target: object, prop: string | symbol): unknown => {
      // drizzle builder 方法依赖 this（this.session 等）：必须先 bind 原对象再包一层
      const orig = (Reflect.get(target, prop, target) as (...args: unknown[]) => unknown).bind(target);
      return wrapWriter(orig);
    };
    const wrapTx = (tx: object): unknown =>
      new Proxy(tx, {
        get(target, prop) {
          if (prop === 'insert' || prop === 'update' || prop === 'delete') return wrapWriterProp(target, prop);
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    return new Proxy(base, {
      get(target, prop) {
        if (prop === 'transaction') {
          const orig = Reflect.get(target, prop, target) as (cb: (tx: unknown) => unknown) => unknown;
          return (cb: (tx: unknown) => unknown) => orig.call(target, (tx) => cb(wrapTx(tx as object)));
        }
        if (prop === 'insert' || prop === 'update' || prop === 'delete') return wrapWriterProp(target, prop);
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as unknown as import('../src/db').Db;
  }

  it('第二个键写入失败 → 第一个键不残留（事务回滚，不留半更新）', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createDb } = await import('../src/db');
    const { SettingsService } = await import('../src/settings/settings.service');
    const dir = mkdtempSync(join(tmpdir(), 'homestock-settings-tx-'));
    const db = createDb(join(dir, 'stock.db'));
    const sqlite = (db as unknown as { $client: import('better-sqlite3').Database }).$client;
    try {
      // 种子初始值 default_remind_days=3 / reminder_hour=8；PUT 同时改两个键，第 2 次写失败
      const settings = new SettingsService(flakyDb(db, 2));
      await expect(settings.update({ default_remind_days: 7, reminder_hour: 20 })).rejects.toThrow(
        'simulated db failure',
      );
      const rows = sqlite
        .prepare(`SELECT key, value FROM settings WHERE key IN ('default_remind_days', 'reminder_hour')`)
        .all() as { key: string; value: string }[];
      const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      expect(map.default_remind_days).toBe('3');
      expect(map.reminder_hour).toBe('8');
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
