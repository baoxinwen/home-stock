/**
 * 应用内渠道（M7.3）。
 *
 * 评审 Important 2：通知记录的写入与去重已上移到 NotificationLedger，
 * 本渠道不再写 notifications 表 —— 它只表达“应用内通知是否启用”，
 * 并在渠道结果里留痕（记录行由 ledger 在派发前占位创建）。
 * 因此即使 inapp 被关闭，ledger 仍能保证 email/wecom 不重发。
 */
import type { Notifier, NotifierResult, NotifyJob } from './notifier';
import type { RawSettings } from '../settings/settings.service';

export class InAppNotifier implements Notifier {
  readonly name = 'inapp' as const;

  isEnabled(settings: RawSettings): boolean {
    const inapp = (settings as unknown as { inapp?: { enabled?: number } }).inapp;
    return inapp?.enabled !== 0;
  }

  async send(_job: NotifyJob, _settings: RawSettings): Promise<NotifierResult> {
    // 记录行已由 NotificationLedger.reserve() 写入；这里只确认渠道可用
    return { channel: 'inapp', ok: true };
  }
}
