/**
 * 物品图片（0006，P1 单图）：
 * - POST /api/uploads：白名单类型 + 魔数校验 + 大小上限；成功返回随机文件名
 * - GET /api/uploads/:file：?token= 鉴权（I-7 白名单）、非法文件名拒绝、404
 * - items 关联：create/update 带 imagePath、非法形态 400、换图/删物品的文件清理
 * - 孤儿清理：未被引用且过期文件删除，被引用保留
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { existsSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ItemDto } from '@home-stock/shared';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';

let ctx: TestCtx;
let seq = 0;
const uid = (label: string) => `${label}_${Date.now()}_${++seq}`;
/** 鉴权用例需要真实口令：实例显式开启（默认 null 时中间件直通，401 路径无法覆盖） */
const TOKEN = 'uploads-test-token';

/** 最小合法图片 buffer（仅含魔数；sniff 只看前 12 字节） */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);

beforeAll(async () => {
  ctx = await startTestApp({ accessToken: TOKEN });
});

afterAll(async () => {
  await stopTestApp(ctx);
});

const server = () => ctx.app.getHttpServer();
const uploadsDir = () => join(dirname(ctx.dbPath), 'uploads');
const auth = (req: request.Test) => req.set('x-access-token', TOKEN);

async function upload(buffer: Buffer, mime: string, filename = 'a.png'): Promise<{ status: number; path: string | null; body: Record<string, unknown> }> {
  const res = await auth(request(server()).post('/api/uploads'))
    .attach('file', buffer, { filename, contentType: mime });
  return { status: res.status, path: (res.body.data as { path?: string } | undefined)?.path ?? null, body: res.body };
}

describe('POST /api/uploads', () => {
  it('png/webp 上传成功：返回随机文件名且落盘', async () => {
    for (const [buf, mime] of [
      [PNG_HEAD, 'image/png'],
      [WEBP_HEAD, 'image/webp'],
    ] as const) {
      const { status, path } = await upload(Buffer.from(buf), mime);
      expect(status).toBe(201);
      expect(path).toMatch(/^[0-9a-f]{32}\.(png|webp)$/);
      expect(existsSync(join(uploadsDir(), path!))).toBe(true);
    }
  });

  it('类型与魔数不符 → 400（伪装扩展名拒绝）', async () => {
    const { status, path } = await upload(Buffer.from(PNG_HEAD), 'image/jpeg', 'a.png');
    expect(status).toBe(400);
    expect(path).toBeNull();
  });

  it('非白名单类型 → 400', async () => {
    const { status } = await upload(Buffer.from('hello world hello'), 'text/plain', 'a.txt');
    expect(status).toBe(400);
  });

  it('超过 2MB → 413（multer 上限）', async () => {
    const big = Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(2 * 1024 * 1024)]);
    const res = await auth(request(server()).post('/api/uploads'))
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect([400, 413]).toContain(res.status);
  });

  it('未鉴权上传 → 401', async () => {
    const res = await request(server()).post('/api/uploads').attach('file', Buffer.from(PNG_HEAD), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/uploads/:file', () => {
  it('?token= 鉴权下发（I-7 白名单），无 token → 401', async () => {
    const { path } = await upload(Buffer.from(PNG_HEAD), 'image/png');
    const ok = await request(server()).get(`/api/uploads/${path}?token=${encodeURIComponent(TOKEN)}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/png');

    const denied = await request(server()).get(`/api/uploads/${path}`);
    expect(denied.status).toBe(401);
  });

  it('非法文件名（路径穿越/非白名单形态）→ 400/404，绝不读任意路径', async () => {
    for (const name of ['..%2F..%2Fstock.db', 'zzzz.jpg', `${'a'.repeat(32)}.gif`]) {
      const res = await request(server()).get(`/api/uploads/${name}?token=${encodeURIComponent(TOKEN)}`);
      expect([400, 404]).toContain(res.status);
    }
  });

  it('不存在的文件 → 404', async () => {
    const res = await request(server()).get(`/api/uploads/${'b'.repeat(32)}.png?token=${encodeURIComponent(TOKEN)}`);
    expect(res.status).toBe(404);
  });
});

describe('items 图片关联（0006）', () => {
  it('create 带 imagePath → DTO 返回；非法形态 → 400', async () => {
    const { path } = await upload(Buffer.from(PNG_HEAD), 'image/png');
    const created = await auth(request(server()).post('/api/items')).send({
      name: uid('带图物品'),
      quantity: 1,
      imagePath: path,
    });
    expect(created.status).toBe(201);
    expect((created.body.data as ItemDto).imagePath).toBe(path);

    const bad = await auth(request(server()).post('/api/items')).send({
      name: uid('坏路径'),
      quantity: 1,
      imagePath: '../../etc/passwd',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
  });

  it('换图 → 旧文件被清理，新文件保留', async () => {
    const first = await upload(Buffer.from(PNG_HEAD), 'image/png');
    const second = await upload(Buffer.from(JPG_HEAD), 'image/jpeg', 'b.jpg');
    const created = await auth(request(server()).post('/api/items')).send({
      name: uid('换图物品'),
      quantity: 1,
      imagePath: first.path,
    });
    const id = (created.body.data as ItemDto).id;

    const updated = await auth(request(server()).put(`/api/items/${id}`)).send({ imagePath: second.path });
    expect(updated.status).toBe(200);
    expect((updated.body.data as ItemDto).imagePath).toBe(second.path);
    expect(existsSync(join(uploadsDir(), second.path!))).toBe(true);
    expect(existsSync(join(uploadsDir(), first.path!))).toBe(false);
  });

  it('删除物品 → 图片文件同步清理', async () => {
    const { path } = await upload(Buffer.from(PNG_HEAD), 'image/png');
    const created = await auth(request(server()).post('/api/items')).send({
      name: uid('删图物品'),
      quantity: 1,
      imagePath: path,
    });
    const id = (created.body.data as ItemDto).id;
    const del = await auth(request(server()).delete(`/api/items/${id}`));
    expect(del.status).toBe(200);
    expect(existsSync(join(uploadsDir(), path!))).toBe(false);
  });

  it('update imagePath=null 清除图片', async () => {
    const { path } = await upload(Buffer.from(PNG_HEAD), 'image/png');
    const created = await auth(request(server()).post('/api/items')).send({
      name: uid('清图物品'),
      quantity: 1,
      imagePath: path,
    });
    const id = (created.body.data as ItemDto).id;
    const updated = await auth(request(server()).put(`/api/items/${id}`)).send({ imagePath: null });
    expect(updated.status).toBe(200);
    expect((updated.body.data as ItemDto).imagePath).toBeNull();
    expect(existsSync(join(uploadsDir(), path!))).toBe(false);
  });
});

describe('孤儿清理（sweepOrphanUploads）', () => {
  it('未被引用且 mtime 超过 24h → 删除；被引用 → 保留；新孤儿保留', async () => {
    const referenced = await upload(Buffer.from(PNG_HEAD), 'image/png');
    await auth(request(server()).post('/api/items')).send({ name: uid('引用者'), quantity: 1, imagePath: referenced.path });

    const staleOrphan = join(uploadsDir(), `${'c'.repeat(32)}.png`);
    const freshOrphan = join(uploadsDir(), `${'d'.repeat(32)}.png`);
    mkdirSync(uploadsDir(), { recursive: true });
    writeFileSync(staleOrphan, PNG_HEAD);
    writeFileSync(freshOrphan, PNG_HEAD);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(staleOrphan, old, old);

    // bootstrap 启动时同款调用（app.get 拿到与容器一致的 service 实例）
    const { UploadsService } = await import('../src/uploads/uploads.service');
    const removed = ctx.app.get(UploadsService).sweepOrphans();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(staleOrphan)).toBe(false);
    expect(existsSync(freshOrphan)).toBe(true);
    expect(existsSync(join(uploadsDir(), referenced.path!))).toBe(true);
  });
});
