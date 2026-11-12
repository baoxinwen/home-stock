/**
 * 渠道抽象（规格第 8 节：Notifier 接口 + Email/Wecom/InApp 实现，渠道可插拔）。
 * 单渠道失败由 send 内部捕获为 { ok:false, error }，绝不抛出；派发器再兜一层 try/catch。
 */
import type { NotifyChannel, NotificationType } from '@home-stock/shared';
import type { RawSettings } from '../settings/settings.service';

/** 一次提醒任务。去重由 NotificationLedger 按 (item_id, type) 终身保证；sentDate 仅作记录与并发兜底键 */
export interface NotifyJob {
  itemId: number;
  itemName: string;
  type: NotificationType;
  /** 本次发送日 YYYY-MM-DD（写入 notifications.sent_date） */
  sentDate: string;
  title: string;
  body: string;
}

export interface NotifierResult {
  channel: NotifyChannel;
  ok: boolean;
  /** 未启用而被跳过（视为正常，不算失败） */
  skipped?: boolean;
  error?: string;
}

export interface Notifier {
  readonly name: NotifyChannel;
  isEnabled(settings: RawSettings): boolean;
  send(job: NotifyJob, settings: RawSettings): Promise<NotifierResult>;
}

/** 日志写入点（结构性满足 NotificationsService） */
export interface LogSink {
  log(channel: string, level: 'error' | 'warn' | 'info', message: string): void;
}

export function ok(channel: NotifyChannel): NotifierResult {
  return { channel, ok: true };
}

export function skipped(channel: NotifyChannel): NotifierResult {
  return { channel, ok: true, skipped: true };
}

export function fail(channel: NotifyChannel, error: unknown): NotifierResult {
  return { channel, ok: false, error: error instanceof Error ? error.message : String(error) };
}
