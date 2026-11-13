/**
 * 物品图片（0006）展示辅助：`<img>` 无法带 X-Access-Token 头，
 * 图片 URL 统一走 ?token= 鉴权（server 侧 I-7 白名单仅对 /api/uploads GET 开放）。
 */
import { getStoredToken } from '../auth/token';

export function imageUrl(imagePath: string): string {
  const token = getStoredToken() ?? '';
  return `/api/uploads/${imagePath}?token=${encodeURIComponent(token)}`;
}
