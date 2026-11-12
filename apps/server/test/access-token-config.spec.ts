/**
 * Task8 Fix Round 1（I1）— 访问口令 fail-closed 配置校验。
 * 只有 NODE_ENV 显式为 development/test 才允许空口令；生产必须配置非空白、足够长的口令。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/bootstrap';
import {
  MIN_ACCESS_TOKEN_LENGTH,
  normalizeAccessToken,
  resolveAccessToken,
} from '../src/common/access-token.config';

function env(patch: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return patch as NodeJS.ProcessEnv;
}

let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('resolveAccessToken（fail-closed）', () => {
  it('production 未配置 ACCESS_TOKEN → 拒绝启动', () => {
    expect(() => resolveAccessToken({}, env({ NODE_ENV: 'production' }))).toThrow(/ACCESS_TOKEN/);
  });

  it('production 空/纯空白 ACCESS_TOKEN → 拒绝启动', () => {
    expect(() => resolveAccessToken({}, env({ NODE_ENV: 'production', ACCESS_TOKEN: '' }))).toThrow(
      /ACCESS_TOKEN/,
    );
    expect(() =>
      resolveAccessToken({}, env({ NODE_ENV: 'production', ACCESS_TOKEN: '   ' })),
    ).toThrow(/ACCESS_TOKEN/);
  });

  it('production 显式 accessToken:null → 拒绝启动', () => {
    expect(() =>
      resolveAccessToken({ accessToken: null }, env({ NODE_ENV: 'production' })),
    ).toThrow(/ACCESS_TOKEN/);
  });

  it('production 口令过短 → 拒绝启动', () => {
    const short = 'a'.repeat(MIN_ACCESS_TOKEN_LENGTH - 1);
    expect(() =>
      resolveAccessToken({}, env({ NODE_ENV: 'production', ACCESS_TOKEN: short })),
    ).toThrow(/至少/);
  });

  it('production 合法口令 → trim 后返回', () => {
    expect(
      resolveAccessToken({}, env({ NODE_ENV: 'production', ACCESS_TOKEN: '  family-secret  ' })),
    ).toBe('family-secret');
  });

  it('NODE_ENV 未显式设置 → 拒绝启动（不把 undefined 当开发环境）', () => {
    expect(() => resolveAccessToken({}, env({ ACCESS_TOKEN: undefined }))).toThrow(/ACCESS_TOKEN/);
  });

  it('development/test 显式允许空口令', () => {
    expect(resolveAccessToken({}, env({ NODE_ENV: 'test' }))).toBeNull();
    expect(resolveAccessToken({ accessToken: null }, env({ NODE_ENV: 'development' }))).toBeNull();
  });

  it('normalizeAccessToken：空白视为未配置', () => {
    expect(normalizeAccessToken('   ')).toBeNull();
    expect(normalizeAccessToken('  x  ')).toBe('x');
    expect(normalizeAccessToken(null)).toBeNull();
  });
});

describe('createApplication 启动时校验（I1）', () => {
  it('production 无口令 → 启动失败，不创建可用应用', async () => {
    dir = mkdtempSync(join(tmpdir(), 'homestock-i1-'));
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        createApplication({
          dbPath: join(dir, 'stock.db'),
          accessToken: undefined,
          scheduler: false,
          publicDir: null,
        }),
      ).rejects.toThrow(/ACCESS_TOKEN/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('test 环境显式 null → 可启动（测试/开发专用）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'homestock-i1-'));
    const { app, handle } = await createApplication({
      dbPath: join(dir, 'stock.db'),
      accessToken: null,
      scheduler: false,
      publicDir: null,
    });
    await app.close();
    handle.close();
  });
});
