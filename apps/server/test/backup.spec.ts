/**
 * Task8 RED — 备份与恢复（M8.1/M8.2/M8.3）+ 定时备份保留策略。
 * 危险操作（恢复）先写失败测试：校验 → 安全备份 → 替换 → 可回滚。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import request, { type Response as SupertestResponse } from 'supertest';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';
import { ApiException } from '../src/common/api.exception';
import { BackupService } from '../src/backup/backup.service';
import { BackupScheduler } from '../src/backup/backup.scheduler';

const SQLITE_MAGIC = 'SQLite format 3';

function binaryParser(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

function http(ctx: TestCtx) {
  return request(ctx.app.getHttpServer());
}

async function downloadBackup(ctx: TestCtx): Promise<{ res: SupertestResponse; buffer: Buffer }> {
  const res = await http(ctx).get('/api/backup').buffer(true).parse(binaryParser as never);
  return { res, buffer: res.body as Buffer };
}

async function restore(ctx: TestCtx, buffer: Buffer, filename = 'backup.db') {
  return http(ctx).post('/api/backup/restore').attach('file', buffer, filename);
}

async function itemNames(ctx: TestCtx): Promise<string[]> {
  const res = await http(ctx).get('/api/items');
  expect(res.status).toBe(200);
  return res.body.data.map((i: { name: string }) => i.name);
}

function tablesOf(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[]
    ).map((r) => r.name);
  } finally {
    db.close();
  }
}

function makeSqliteWithOnlySettings(file: string): void {
  const db = new Database(file);
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  db.close();
}

describe('GET /api/backup（M8.1 手动备份下载）', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await startTestApp();
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('返回 attachment 快照，可被 SQLite 打开且包含全部业务表', async () => {
    await http(ctx).post('/api/items').send({ name: '牛奶', quantity: 2, unit: '盒' });

    const { res, buffer } = await downloadBackup(ctx);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-disposition'])).toMatch(
      /^attachment; filename="stock-\d{8}-\d{6}\.db"$/,
    );
    expect(buffer.subarray(0, 16).toString('utf8')).toContain(SQLITE_MAGIC);

    const snapshot = join(ctx.dir, 'downloaded.db');
    writeFileSync(snapshot, buffer);
    const tables = tablesOf(snapshot);
    for (const t of [
      'categories',
      'items',
      'shopping_list_items',
      'notifications',
      'notification_logs',
      'settings',
    ]) {
      expect(tables).toContain(t);
    }
    // 快照含备份时的数据
    const db = new Database(snapshot, { readonly: true });
    const count = db.prepare(`SELECT COUNT(*) AS c FROM items`).get() as { c: number };
    db.close();
    expect(count.c).toBe(1);
  });
});

describe('GET /api/backup/list（备份列表）', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await startTestApp();
    mkdirSync(ctx.backupDir, { recursive: true });
    writeFileSync(join(ctx.backupDir, 'stock-20260101-010101.db'), Buffer.from('old'));
    writeFileSync(join(ctx.backupDir, 'pre-restore-20260102-020202.db'), Buffer.from('safety'));
    writeFileSync(join(ctx.backupDir, 'notes.txt'), 'ignore me');
    const old = new Date('2026-01-01T01:01:01Z');
    const safety = new Date('2026-01-02T02:02:02Z');
    utimesSync(join(ctx.backupDir, 'stock-20260101-010101.db'), old, old);
    utimesSync(join(ctx.backupDir, 'pre-restore-20260102-020202.db'), safety, safety);
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('返回文件名/大小/时间，按时间倒序，忽略非 .db 文件', async () => {
    const res = await http(ctx).get('/api/backup/list');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ name: 'pre-restore-20260102-020202.db', size: 6 });
    expect(res.body.data[1]).toMatchObject({ name: 'stock-20260101-010101.db', size: 3 });
    expect(typeof res.body.data[0].createdAt).toBe('string');
  });
});

describe('POST /api/backup/restore（M8.2 手动恢复）', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await startTestApp();
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('恢复成功：数据回到备份点，恢复前自动安全备份当前库', async () => {
    await http(ctx).post('/api/items').send({ name: '备份时的牛奶', quantity: 1 });
    const { buffer } = await downloadBackup(ctx);
    await http(ctx).post('/api/items').send({ name: '备份后新增的面包', quantity: 1 });
    expect(await itemNames(ctx)).toEqual(['备份时的牛奶', '备份后新增的面包']);

    const res = await restore(ctx, buffer);
    expect(res.status).toBe(201);
    expect(res.body.data.restored.items).toBe(1);
    expect(res.body.data.safetyBackup).toMatch(/^pre-restore-.*\.db$/);

    // 主库已替换，服务仍可用
    expect(await itemNames(ctx)).toEqual(['备份时的牛奶']);

    // 安全备份存在，且是恢复前（2 条）的数据
    const safetyPath = join(ctx.backupDir, res.body.data.safetyBackup);
    expect(tablesOf(safetyPath)).toContain('items');
    const safety = new Database(safetyPath, { readonly: true });
    const count = safety.prepare(`SELECT COUNT(*) AS c FROM items`).get() as { c: number };
    safety.close();
    expect(count.c).toBe(2);
  });

  it('非 SQLite 文件 → 400，主库无损', async () => {
    await http(ctx).post('/api/items').send({ name: '原数据' });
    const res = await restore(ctx, Buffer.from('this is definitely not a sqlite database'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await itemNames(ctx)).toEqual(['原数据']);
  });

  it('缺少必需表 → 400，主库无损', async () => {
    await http(ctx).post('/api/items').send({ name: '原数据' });
    const badPath = join(ctx.dir, 'only-settings.db');
    makeSqliteWithOnlySettings(badPath);
    const res = await restore(ctx, readFileSync(badPath));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('items');
    expect(await itemNames(ctx)).toEqual(['原数据']);
  });

  it('空文件 → 400（空输入边界）', async () => {
    const res = await restore(ctx, Buffer.alloc(0), 'empty.db');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('并发两次恢复只成功一次（第二次 409 RESTORE_IN_PROGRESS）', async () => {
    await http(ctx).post('/api/items').send({ name: '并发前' });
    const { buffer } = await downloadBackup(ctx);
    const svc = ctx.app.get(BackupService);

    const results = await Promise.allSettled([svc.restore(buffer), svc.restore(buffer)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = rejected[0].reason as ApiException;
    expect(reason.getStatus()).toBe(409);
    expect((reason.getResponse() as { code: string }).code).toBe('RESTORE_IN_PROGRESS');
    // 服务仍可用
    expect(await itemNames(ctx)).toEqual(['并发前']);
  });

  it('安全备份目录不可写 → 恢复失败但主库仍可用（不崩溃）', async () => {
    await http(ctx).post('/api/items').send({ name: '仍在' });
    const { buffer } = await downloadBackup(ctx);

    const notADir = join(ctx.dir, 'backup-dir-is-a-file');
    writeFileSync(notADir, 'x');
    const logs: { channel: string; level: string; message: string }[] = [];
    const broken = new BackupService(ctx.handle, {
      backupDir: notADir,
      log: (channel, level, message) => logs.push({ channel, level, message }),
    });
    const err = await broken.restore(buffer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).getStatus()).toBe(500);
    expect(logs.some((l) => l.channel === 'backup' && l.level === 'error')).toBe(true);
    expect(await itemNames(ctx)).toEqual(['仍在']);
  });
});

describe('定时备份与保留策略（M8.3）', () => {
  let ctx: TestCtx;
  let svc: BackupService;

  beforeEach(async () => {
    ctx = await startTestApp();
    svc = ctx.app.get(BackupService);
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('runScheduledBackup 写入 BACKUP_DIR 且快照可打开', async () => {
    const res = await svc.runScheduledBackup();
    expect(res.ok).toBe(true);
    expect(res.file).toMatch(/^stock-\d{8}-\d{6}\.db$/);
    expect(tablesOf(join(ctx.backupDir, res.file as string))).toContain('items');
  });

  it('保留份数清理：20 份只留最新 14 份（按时间排序删旧）', async () => {
    mkdirSync(ctx.backupDir, { recursive: true });
    for (let i = 0; i < 20; i += 1) {
      const name = `stock-202601${String(i + 1).padStart(2, '0')}-000000.db`;
      const file = join(ctx.backupDir, name);
      writeFileSync(file, String(i));
      const t = new Date(2026, 0, i + 1);
      utimesSync(file, t, t);
    }
    const deleted = svc.prune(14);
    expect(deleted).toHaveLength(6);
    const left = readdirSync(ctx.backupDir).filter((n) => n.startsWith('stock-'));
    expect(left).toHaveLength(14);
    expect(left).not.toContain('stock-20260101-000000.db');
    expect(left).toContain('stock-20260120-000000.db');
  });

  it('BACKUP_KEEP=0（极值）→ 不保留任何定时备份，也不崩溃', async () => {
    await svc.runScheduledBackup();
    const deleted = svc.prune(0);
    expect(deleted.length).toBeGreaterThanOrEqual(1);
    expect(readdirSync(ctx.backupDir).filter((n) => n.startsWith('stock-'))).toHaveLength(0);
  });

  it('pre-restore-* 也纳入保留份数（最近 N 份）', async () => {
    mkdirSync(ctx.backupDir, { recursive: true });
    for (let i = 0; i < 10; i += 1) {
      for (const prefix of ['stock-', 'pre-restore-']) {
        const file = join(ctx.backupDir, `${prefix}202601${String(i + 1).padStart(2, '0')}-000000.db`);
        writeFileSync(file, String(i));
        const t = new Date(2026, 0, i + 1);
        utimesSync(file, t, t);
      }
    }
    svc.prune(14);
    const left = readdirSync(ctx.backupDir).filter((n) => n.endsWith('.db'));
    expect(left).toHaveLength(14);
    expect(left.some((n) => n.startsWith('pre-restore-'))).toBe(true);
    expect(left).toContain('pre-restore-20260110-000000.db');
    expect(left).not.toContain('pre-restore-20260101-000000.db');
  });

  it('总量上限：超过 BACKUP_MAX_BYTES 时继续删最旧（pre-restore 同样计入）', async () => {
    mkdirSync(ctx.backupDir, { recursive: true });
    const names = [
      'stock-20260101-000000.db',
      'pre-restore-20260102-000000.db',
      'stock-20260103-000000.db',
      'pre-restore-20260104-000000.db',
      'stock-20260105-000000.db',
    ];
    names.forEach((name, i) => {
      const file = join(ctx.backupDir, name);
      writeFileSync(file, Buffer.alloc(40, i));
      const t = new Date(2026, 0, i + 1);
      utimesSync(file, t, t);
    });
    const limited = new BackupService(ctx.handle, {
      backupDir: ctx.backupDir,
      keep: 10,
      maxBytes: 100,
      log: () => undefined,
    });
    const deleted = limited.prune();
    // 5×40=200B，上限 100B → 删最旧 3 份，留最新 2 份
    expect(deleted).toHaveLength(3);
    const left = readdirSync(ctx.backupDir).filter((n) => n.endsWith('.db'));
    expect(left.sort()).toEqual([
      'pre-restore-20260104-000000.db',
      'stock-20260105-000000.db',
    ]);
  });

  it('单份备份体积超过 BACKUP_MAX_BYTES → 至少保留最新一份，不全删（M4①）', () => {
    mkdirSync(ctx.backupDir, { recursive: true });
    const names = ['stock-20260101-000000.db', 'stock-20260102-000000.db', 'stock-20260103-000000.db'];
    names.forEach((name, i) => {
      const file = join(ctx.backupDir, name);
      writeFileSync(file, Buffer.alloc(100, i));
      const t = new Date(2026, 0, i + 1);
      utimesSync(file, t, t);
    });
    // 单份 100B > 预算 50B：keptBytes + size <= budget 恒假 → 旧实现全部删除
    const limited = new BackupService(ctx.handle, {
      backupDir: ctx.backupDir,
      keep: 10,
      maxBytes: 50,
      log: () => undefined,
    });
    const deleted = limited.prune();
    expect(deleted).toHaveLength(2);
    expect(deleted).not.toContain('stock-20260103-000000.db');
    const left = readdirSync(ctx.backupDir).filter((n) => n.endsWith('.db')).sort();
    expect(left).toEqual(['stock-20260103-000000.db']);
  });

  it('snapshotTo 中途失败 → 删除残留半成品 dest，不被 list()/prune() 当有效备份占坑（M4②）', async () => {
    mkdirSync(ctx.backupDir, { recursive: true });
    // 模拟 backup API 中途失败（磁盘满等）：dest 已写入一半再抛错
    const spy = vi.spyOn(ctx.handle.sqlite, 'backup').mockImplementation(async (dest: string) => {
      writeFileSync(dest, 'half-written garbage');
      throw new Error('disk full');
    });
    try {
      const res = await svc.runScheduledBackup();
      expect(res.ok).toBe(false);
      expect(res.error).toContain('disk full');
      expect(readdirSync(ctx.backupDir).filter((n) => n.endsWith('.db'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('BACKUP_DIR 是文件 → list 返回空数组，错误路径不崩溃', () => {
    const notADir = join(ctx.dir, 'list-dir-is-file');
    writeFileSync(notADir, 'x');
    const broken = new BackupService(ctx.handle, { backupDir: notADir, log: () => undefined });
    expect(broken.list()).toEqual([]);
  });

  it('BACKUP_DIR 不可写 → 返回 ok:false 并写错误日志，不抛异常', async () => {
    const notADir = join(ctx.dir, 'not-a-dir');
    writeFileSync(notADir, 'x');
    const logs: { channel: string; level: string; message: string }[] = [];
    const broken = new BackupService(ctx.handle, {
      backupDir: notADir,
      log: (channel, level, message) => logs.push({ channel, level, message }),
    });
    const res = await broken.runScheduledBackup();
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(logs.some((l) => l.channel === 'backup' && l.level === 'error')).toBe(true);
  });
});

describe('恢复后提醒引擎可用（评审 C-1：ledger 不得缓存已关闭连接）', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await startTestApp();
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('恢复备份成功 → POST /api/reminders/run 返回 200 且 notifications 落 inapp 记录', async () => {
    // 造一条已过期物品（备份里无通知记录 → 恢复后扫描必触发 expired 提醒）
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const created = await http(ctx).post('/api/items').send({ name: '恢复后提醒牛奶', quantity: 1, expiryDate: yesterday });
    expect(created.status).toBe(201);
    const itemId = created.body.data.id as number;

    const { buffer } = await downloadBackup(ctx);
    const restored = await restore(ctx, buffer);
    expect(restored.status).toBe(201);

    // 恢复后手动触发扫描：当前实现 ledger 缓存了已关闭的旧连接 → 500
    const runRes = await http(ctx).post('/api/reminders/run').send({});
    expect(runRes.status).toBe(200);

    const rows = ctx.handle.sqlite
      .prepare(`SELECT type, channels FROM notifications WHERE item_id = ?`)
      .all(itemId) as { type: string; channels: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('expired');
    expect(JSON.parse(rows[0].channels as string)).toMatchObject({ inapp: { ok: true } });
  });

  it('再次恢复（多轮 close/reopen）后提醒引擎仍正常（重启后回归）', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const created = await http(ctx).post('/api/items').send({ name: '多轮恢复牛奶', quantity: 1, expiryDate: yesterday });
    expect(created.status).toBe(201);
    const itemId = created.body.data.id as number;
    const { buffer } = await downloadBackup(ctx);

    for (let round = 1; round <= 2; round += 1) {
      const restored = await restore(ctx, buffer);
      expect(restored.status).toBe(201);
      const runRes = await http(ctx).post('/api/reminders/run').send({});
      expect(runRes.status).toBe(200);
      const rows = ctx.handle.sqlite
        .prepare(`SELECT type FROM notifications WHERE item_id = ?`)
        .all(itemId) as { type: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('expired');
      // 第二轮恢复前先清掉上一轮的通知记录，确保本轮扫描确实重新写入
      if (round === 1) {
        ctx.handle.sqlite.prepare(`DELETE FROM notifications`).run();
      }
    }
  });
});

describe('BackupScheduler（node-cron 注册）', () => {
  function fakeCron() {
    const tasks: { expr: string; opts?: { timezone?: string }; stopped: boolean; fn: () => void }[] = [];
    return {
      tasks,
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
        tasks.push(task);
        return task;
      },
    };
  }

  it('按 BACKUP_INTERVAL 注册；触发时执行备份；销毁时停止', async () => {
    const cron = fakeCron();
    const runScheduledBackup = vi.fn().mockResolvedValue({ ok: true });
    const s = new BackupScheduler({ runScheduledBackup }, { interval: '*/5 * * * *', cron: cron as never });
    s.onModuleInit();
    expect(cron.tasks).toHaveLength(1);
    expect(cron.tasks[0].expr).toBe('*/5 * * * *');

    await cron.tasks[0].fn();
    expect(runScheduledBackup).toHaveBeenCalledTimes(1);

    s.onModuleDestroy();
    expect(cron.tasks[0].stopped).toBe(true);
  });

  it('非法 cron 表达式 → 记录 warn，不崩溃', () => {
    const logs: { channel: string; level: string; message: string }[] = [];
    const cron = {
      schedule: () => {
        throw new Error('invalid cron');
      },
    };
    const s = new BackupScheduler(
      { runScheduledBackup: vi.fn() },
      { interval: 'not-a-cron', cron: cron as never, log: (channel, level, message) => logs.push({ channel, level, message }) },
    );
    expect(() => s.onModuleInit()).not.toThrow();
    expect(logs.some((l) => l.channel === 'backup' && l.level === 'warn')).toBe(true);
  });
});
