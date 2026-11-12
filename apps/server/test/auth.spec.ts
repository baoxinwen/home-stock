/**
 * Task8 RED — 访问口令（M9.2）。
 * 规格：Header `X-Access-Token`；错误/缺失 → 401 { code: 'UNAUTHORIZED', message }；
 * `?token=` 仅备份下载类 GET（I-7 收窄，普通 GET 不再接受 query 口令）；
 * `/api/health` 与前端静态资源豁免；reminders/run 与 settings/notify-test 一并受保护。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestApp, stopTestApp, type TestCtx } from './helpers';
import { tokensMatch } from '../src/common/access-token.middleware';

const TOKEN = 'family-secret';

function api(ctx: TestCtx) {
  return request(ctx.app.getHttpServer());
}

describe('访问口令中间件（M9.2）', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await startTestApp({ accessToken: TOKEN });
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('未携带口令 → 401 { code: UNAUTHORIZED, message }', async () => {
    const res = await api(ctx).get('/api/items');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(typeof res.body.message).toBe('string');
  });

  it('错误口令 → 401', async () => {
    const res = await api(ctx).get('/api/items').set('X-Access-Token', 'wrong-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('正确口令（Header）→ 200', async () => {
    const res = await api(ctx).get('/api/items').set('X-Access-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('?token= 仅备份下载端点可用：/api/backup、/api/backup/list → 200', async () => {
    const download = await api(ctx).get(`/api/backup?token=${TOKEN}`);
    expect(download.status).toBe(200);

    const list = await api(ctx).get(`/api/backup/list?token=${TOKEN}`);
    expect(list.status).toBe(200);
  });

  it('?token= 正确也不再放行普通 GET：/api/items?token= → 401（I-7 收窄）', async () => {
    const res = await api(ctx).get(`/api/items?token=${TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('./api/health 豁免鉴权', async () => {
    const res = await api(ctx).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('前端静态路径豁免鉴权（不返回 401）', async () => {
    const root = await api(ctx).get('/');
    expect(root.status).not.toBe(401);
    const asset = await api(ctx).get('/assets/index.js');
    expect(asset.status).not.toBe(401);
  });

  it('reminders/run 与 settings/notify-test 纳入鉴权', async () => {
    const run = await api(ctx).post('/api/reminders/run').send({});
    expect(run.status).toBe(401);
    expect(run.body.code).toBe('UNAUTHORIZED');

    const notify = await api(ctx).post('/api/settings/notify-test').send({ channel: 'inapp' });
    expect(notify.status).toBe(401);
    expect(notify.body.code).toBe('UNAUTHORIZED');
  });

  it('长度不同的口令返回 401 而不是 500（timingSafeEqual 不抛异常）', async () => {
    const res = await api(ctx).get('/api/items').set('X-Access-Token', `${TOKEN}-and-more`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('路径大小写不能绕过：/API/items、/Api/items → 401', async () => {
    const upper = await api(ctx).get('/API/items');
    expect(upper.status).toBe(401);
    expect(upper.body.code).toBe('UNAUTHORIZED');

    const mixed = await api(ctx).get('/Api/items');
    expect(mixed.status).toBe(401);
    expect(mixed.body.code).toBe('UNAUTHORIZED');
  });

  it('大小写路径的备份下载与恢复同样受保护', async () => {
    const download = await api(ctx).get('/API/backup');
    expect(download.status).toBe(401);
    expect(download.body.code).toBe('UNAUTHORIZED');

    const before = await api(ctx).get('/api/backup/list').set('X-Access-Token', TOKEN);
    expect(before.status).toBe(200);
    const restore = await api(ctx)
      .post('/API/backup/restore')
      .attach('file', Buffer.from('not-a-real-backup'), 'backup.db');
    expect(restore.status).toBe(401);
    expect(restore.body.code).toBe('UNAUTHORIZED');

    // 鉴权在 multer/恢复逻辑之前：数据未变，也没有生成 pre-restore 安全备份
    const items = await api(ctx).get('/api/items').set('X-Access-Token', TOKEN);
    expect(items.body.data).toEqual([]);
    const after = await api(ctx).get('/api/backup/list').set('X-Access-Token', TOKEN);
    expect(after.body.data).toEqual(before.body.data);
  });

  it('/API/health 同样豁免（路由大小写不敏感）', async () => {
    const res = await api(ctx).get('/API/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('写接口不接受 ?token=（仅 GET 下载类端点可用 query 口令）', async () => {
    const write = await api(ctx).post(`/api/items?token=${TOKEN}`).send({ name: '绕过尝试' });
    expect(write.status).toBe(401);
    expect(write.body.code).toBe('UNAUTHORIZED');

    const restore = await api(ctx)
      .post(`/API/backup/restore?token=${TOKEN}`)
      .attach('file', Buffer.from('not-a-real-backup'), 'backup.db');
    expect(restore.status).toBe(401);

    const items = await api(ctx).get('/api/items').set('X-Access-Token', TOKEN);
    expect(items.body.data).toEqual([]);
  });

  it('空白 query 口令不能通过：?token=%20 → 401', async () => {
    const res = await api(ctx).get('/api/items?token=%20');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

describe('未配置 ACCESS_TOKEN（开发/测试显式关闭）', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await startTestApp({ accessToken: null });
  });

  afterEach(async () => {
    await stopTestApp(ctx);
  });

  it('API 可直接访问（生产由 compose 强制配置 ACCESS_TOKEN）', async () => {
    const res = await api(ctx).get('/api/items');
    expect(res.status).toBe(200);
  });
});

describe('tokensMatch（timing-safe 比较）', () => {
  it('相同口令 → true', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
  });

  it('不同口令 / 不同长度 → false，且不抛异常', () => {
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
    expect(tokensMatch('abc', '')).toBe(false);
    expect(tokensMatch('abc', null)).toBe(false);
  });

  it('非 ASCII 口令同样可比较', () => {
    expect(tokensMatch('家庭口令', '家庭口令')).toBe(true);
    expect(tokensMatch('家庭口令', '家庭口令!')).toBe(false);
  });
});
