import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { API_ERROR_CODES } from '@home-stock/shared';

/**
 * 常量时间比较：先 SHA-256 归一化长度，再 timingSafeEqual，
 * 避免不同长度直接触发异常、也避免按字符提前返回泄露长度信息。
 */
export function tokensMatch(expected: string, provided: string | null | undefined): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256').update(provided, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function queryToken(req: Request): string | undefined {
  const value = req.query?.token;
  return typeof value === 'string' ? value : undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isHealthPath(req: Request): boolean {
  // 挂在 /api 上时 path='/health'；若被全局使用则是 '/api/health'。统一小写 + 去尾斜杠。
  const path = (req.path || '').toLowerCase().replace(/\/+$/, '');
  return path === '/health' || path === '/api/health';
}

function isBackupDownloadPath(req: Request): boolean {
  // I-7：query 口令仅「手动链接下载类」GET 端点保留（应用内 API 已走 Header 鉴权）。
  // 挂在 /api 上时 path='/backup'、'/backup/list'；全局挂载则带 /api 前缀。
  // restore 是 POST 本就不接受 query，不在白名单。
  // 物品图片下发（0006）：<img> 无法带 header，GET /api/uploads/:file 同属此类。
  const path = (req.path || '').toLowerCase().replace(/\/+$/, '');
  return (
    path === '/backup' ||
    path === '/backup/list' ||
    path === '/api/backup' ||
    path === '/api/backup/list' ||
    path.startsWith('/uploads/') ||
    path.startsWith('/api/uploads/')
  );
}

/**
 * 访问口令中间件（M9.2）：
 * - 通过 `app.use('/api', middleware)` 挂载：挂载路径匹配大小写不敏感，避免 `/API/items` 绕过
 * - 接受 `X-Access-Token` 头；`?token=` 仅对备份下载类 GET/HEAD 开放（I-7：其余 GET 一律 Header）
 * - `/api/health`（大小写不敏感）豁免；前端静态资源不在 /api 挂载下，天然豁免
 * - accessToken 为空时由 resolveAccessToken 保证只在 development/test 发生
 */
export function createAccessTokenMiddleware(
  accessToken: string | null | undefined,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!accessToken) {
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    if (isHealthPath(req)) return next();

    const header = firstHeader(req.headers['x-access-token']);
    const method = req.method.toUpperCase();
    const allowQueryToken =
      (method === 'GET' || method === 'HEAD') && isBackupDownloadPath(req);
    const query = allowQueryToken ? queryToken(req) : undefined;

    if (tokensMatch(accessToken, header) || (allowQueryToken && tokensMatch(accessToken, query))) {
      return next();
    }

    res.status(401).json({
      code: API_ERROR_CODES.UNAUTHORIZED,
      message: '访问口令缺失或错误',
    });
  };
}
