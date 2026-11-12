/**
 * Task8 Fix Round 1 — 超大上传 413 边界。
 * 通过 BACKUP_MAX_UPLOAD_BYTES 把上传上限调小，避免测试真的分配 128MB。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { existsSync, readdirSync } from 'node:fs';
import type { TestCtx } from './helpers';

let ctx: TestCtx;
let startTestApp: typeof import('./helpers')['startTestApp'];
let stopTestApp: typeof import('./helpers')['stopTestApp'];

beforeAll(async () => {
  process.env.BACKUP_MAX_UPLOAD_BYTES = '1024';
  vi.resetModules();
  ({ startTestApp, stopTestApp } = await import('./helpers'));
  ctx = await startTestApp();
});

afterAll(async () => {
  delete process.env.BACKUP_MAX_UPLOAD_BYTES;
  if (ctx) await stopTestApp(ctx);
});

describe('POST /api/backup/restore — 超大上传（413）', () => {
  it('超过上限 → 413，恢复未执行，数据不变且无 pre-restore 文件', async () => {
    await request(ctx.app.getHttpServer()).post('/api/items').send({ name: '原数据' });

    const res = await request(ctx.app.getHttpServer())
      .post('/api/backup/restore')
      .attach('file', Buffer.alloc(4096), 'too-large.db');

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('VALIDATION_ERROR');

    const items = await request(ctx.app.getHttpServer()).get('/api/items');
    expect(items.body.data.map((i: { name: string }) => i.name)).toEqual(['原数据']);
    const safety = existsSync(ctx.backupDir)
      ? readdirSync(ctx.backupDir).filter((n) => n.startsWith('pre-restore-'))
      : [];
    expect(safety).toHaveLength(0);
  });

  it('上限以内的非法文件仍走 400 校验路径（对照）', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/backup/restore')
      .attach('file', Buffer.alloc(512), 'small-invalid.db');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
