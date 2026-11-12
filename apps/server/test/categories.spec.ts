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

describe('GET /api/categories', () => {
  it('全新库返回默认种子类别（D-2：食品/药品/日用品/个护/其他）', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual([
      '食品',
      '药品',
      '日用品',
      '个护',
      '其他',
    ]);
  });

  it('按 sort_order 排序返回（fixture 排最前，NULL 靠后）', async () => {
    await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '甲_FixtureB', sortOrder: 2 });
    await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '乙_FixtureA', sortOrder: 1 });
    const res = await request(ctx.app.getHttpServer()).get('/api/categories');
    expect(res.status).toBe(200);
    const names = res.body.data.map((c: { name: string }) => c.name);
    // SQLite ASC：sort_order NULL（种子类别）排最前，fixture 1/2 随后
    expect(names.slice(0, 5)).toEqual(['食品', '药品', '日用品', '个护', '其他']);
    expect(names.slice(5, 7)).toEqual(['乙_FixtureA', '甲_FixtureB']);
  });
});

describe('POST /api/categories', () => {
  it('创建并返回 201 + CategoryDto', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '日化', sortOrder: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: '日化', sortOrder: 3 });
    expect(res.body.data.id).toBeGreaterThan(0);
  });

  it('name 缺失/空白 → 400 VALIDATION_ERROR', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }]) {
      const res = await request(ctx.app.getHttpServer()).post('/api/categories').send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('重名 → 409 DUPLICATE_NAME', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '食品' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
  });

  it('超长 name（>100 字符）→ 400（极值边界）', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: 'a'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /api/categories/:id', () => {
  it('更新名称与排序', async () => {
    const created = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '旧名' });
    const id = created.body.data.id;
    const res = await request(ctx.app.getHttpServer()).put(`/api/categories/${id}`).send({ name: '新名', sortOrder: 9 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, name: '新名', sortOrder: 9 });
  });

  it('不存在 → 404 CATEGORY_NOT_FOUND', async () => {
    const res = await request(ctx.app.getHttpServer()).put('/api/categories/9999').send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('name 为非字符串（如数字）→ 400 VALIDATION_ERROR（与 create 校验一致）', async () => {
    const created = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '类型校验品' });
    const res = await request(ctx.app.getHttpServer()).put(`/api/categories/${created.body.data.id}`).send({ name: 123 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/categories/:id', () => {
  it('无引用可删除', async () => {
    const created = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '可删' });
    const res = await request(ctx.app.getHttpServer()).delete(`/api/categories/${created.body.data.id}`);
    expect(res.status).toBe(200);
    const list = await request(ctx.app.getHttpServer()).get('/api/categories');
    expect(list.body.data.find((c: { id: number }) => c.id === created.body.data.id)).toBeUndefined();
  });

  it('有物品引用 → 409 CATEGORY_IN_USE', async () => {
    const cat = await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: '被引用' });
    await request(ctx.app.getHttpServer()).post('/api/items').send({ name: '牛奶', categoryId: cat.body.data.id });
    const res = await request(ctx.app.getHttpServer()).delete(`/api/categories/${cat.body.data.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CATEGORY_IN_USE');
  });

  it('不存在 → 404 CATEGORY_NOT_FOUND', async () => {
    const res = await request(ctx.app.getHttpServer()).delete('/api/categories/9999');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
  });
});

describe('依赖失败路径', () => {
  it('db 抛错 → 500 统一错误形状 { code: INTERNAL_ERROR }，细节已脱敏', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/categories')
      .send({ name: 'x'.repeat(10) })
      .set('x-force-db-error', '1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
    expect(JSON.stringify(res.body)).not.toContain('forced db failure');
  });

  it('x-force-db-error 只在 NODE_ENV=test 生效（生产无效）', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/categories')
        .set('x-force-db-error', '1');
      expect(res.status).toBe(200);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('路由级 404（Nest 内置 NotFoundException）', () => {
  it('未匹配路由 → 404 + 统一形状 { code: NOT_FOUND }（不再误标 VALIDATION_ERROR）', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(typeof res.body.message).toBe('string');
  });
});

describe('D-M8 新建类别排序排到末尾', () => {
  it('未显式传 sortOrder 时 = 当前最大 + 1（SQLite NULL 先行，null 会插队到最前）', async () => {
    await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: 'D-M8 甲' });
    await request(ctx.app.getHttpServer()).post('/api/categories').send({ name: 'D-M8 乙' });
    const res = await request(ctx.app.getHttpServer()).get('/api/categories');
    const names = (res.body.data as { name: string }[]).map((c) => c.name);
    const first = names.indexOf('D-M8 甲');
    const second = names.indexOf('D-M8 乙');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBe(first + 1); // 按创建顺序排末尾，不插队种子类别前
  });
});
