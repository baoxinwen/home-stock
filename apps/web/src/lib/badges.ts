/**
 * minimalist-ui 徽章映射（brief 第 2 段内联规范值）。
 * expired→Pale Red、expiring→Pale Yellow、ok→Pale Green、none→Pale Blue；
 * 已开封→Pale Blue 角标（expired/expiring 优先）；
 * 归档去向：used_up→Pale Green「用完」、expired_discarded→Pale Red「过期丢弃」。
 */
import type { ExpiryStatus } from '@home-stock/shared';

export type BadgeTone = 'red' | 'yellow' | 'green' | 'blue';

export interface Badge {
  text: string;
  tone: BadgeTone;
}

const STATUS_BADGES: Record<ExpiryStatus, Badge> = {
  expired: { text: '已过期', tone: 'red' },
  expiring: { text: '临期', tone: 'yellow' },
  ok: { text: '在库', tone: 'green' },
  none: { text: '长期', tone: 'blue' },
};

export function badgeFor(expiryStatus?: ExpiryStatus, opened?: number | null): Badge {
  if (expiryStatus === 'expired') return STATUS_BADGES.expired;
  if (expiryStatus === 'expiring') return STATUS_BADGES.expiring;
  if (opened) return { text: '已开封', tone: 'blue' };
  return STATUS_BADGES[expiryStatus ?? 'none'] ?? STATUS_BADGES.none;
}

export function archiveBadgeFor(reason: string | null | undefined): Badge {
  return reason === 'expired_discarded'
    ? { text: '过期丢弃', tone: 'red' }
    : { text: '用完', tone: 'green' };
}
