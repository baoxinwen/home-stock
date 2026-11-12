/**
 * 派发器：逐渠道 try/catch 隔离；单渠道失败写 notification_logs，不阻断其他渠道。
 * 去重/记录由调用方（ReminderService + NotificationLedger）在派发前完成，
 * 本类只负责“把同一份内容送到各已启用渠道”。
 */
import type { NotifyChannel } from '@home-stock/shared';
import type { LogSink, Notifier, NotifierResult, NotifyJob } from './notifier';
import type { RawSettings } from '../settings/settings.service';

export type DispatchResults = Record<string, { ok: boolean; skipped?: boolean; error?: string }>;

export class NotifyDispatcher {
  constructor(
    private readonly notifiers: Notifier[],
    private readonly logs: LogSink,
  ) {}

  async dispatch(job: NotifyJob, settings: RawSettings): Promise<DispatchResults> {
    const results: DispatchResults = {};
    for (const notifier of this.notifiers) {
      const name: NotifyChannel = notifier.name;
      if (!notifier.isEnabled(settings)) {
        results[name] = { ok: true, skipped: true };
        continue;
      }
      try {
        const r = await notifier.send(job, settings);
        results[name] = { ok: r.ok, ...(r.skipped ? { skipped: true } : {}), ...(r.error ? { error: r.error } : {}) };
        if (!r.ok) this.logs.log(name, 'error', `${job.itemName}(${job.itemId}) ${job.type} 发送失败：${r.error ?? '未知错误'}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results[name] = { ok: false, error: message };
        this.logs.log(name, 'error', `${job.itemName}(${job.itemId}) ${job.type} 发送异常：${message}`);
      }
    }
    return results;
  }

  /** 测试发送：只跑指定渠道；未启用/配置缺失都明确报错 */
  async dispatchOne(channel: NotifyChannel, job: NotifyJob, settings: RawSettings): Promise<NotifierResult> {
    const notifier = this.notifiers.find((n) => n.name === channel);
    if (!notifier) return { channel, ok: false, error: `未知渠道：${channel}` };
    try {
      const r = await notifier.send(job, settings);
      if (r.skipped) {
        const failed: NotifierResult = { channel, ok: false, error: `${channel} 渠道未启用` };
        this.logs.log(channel, 'error', `测试消息发送失败：${failed.error}`);
        return failed;
      }
      if (!r.ok) this.logs.log(channel, 'error', `测试消息发送失败：${r.error ?? '未知错误'}`);
      return r;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logs.log(channel, 'error', `测试消息发送异常：${message}`);
      return { channel, ok: false, error: message };
    }
  }
}
