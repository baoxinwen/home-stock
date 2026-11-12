import type { Request } from 'express';

/**
 * 依赖失败路径的测试钩子：请求头 `x-force-db-error=1` 时人为抛错。
 * 只在 NODE_ENV=test 下生效，生产构建里等同不存在（不会再被外部请求触发 500）。
 */
export function assertNotForcedDbError(req: Request): void {
  if (process.env.NODE_ENV !== 'test') return;
  if (req.headers['x-force-db-error'] === '1') {
    throw new Error('forced db failure (test hook)');
  }
}
