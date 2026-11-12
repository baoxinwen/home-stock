/**
 * 全局收尾：webServer 此刻可能仍存活并持有库句柄（实测），因此本次 run 目录只做
 * 尽力删除；server 退出后句柄释放，残留目录由下一轮 globalSetup 兜底清理。
 */
import { rmSync } from 'node:fs';
import { currentRunDataDir, pruneStaleRunDirs } from './helpers/env';

export default function globalTeardown(): void {
  const dir = currentRunDataDir();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // server 尚未退出：留待下一轮 globalSetup 清理
  }
  pruneStaleRunDirs(dir);
}
