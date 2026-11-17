import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { API_ERROR_CODES, NOTIFY_CHANNELS, type NotifyChannel, type NotifyTestRequest } from '@home-stock/shared';
import { ApiException } from '../common/api.exception';
import { ReminderService } from './reminder.service';
import { NotifyDispatcher } from '../notifications/notify.dispatcher';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { localDate } from './clock';

/** POST /api/reminders/run —— 手动触发扫描（便于验证；鉴权由全局 access-token 中间件统一覆盖 /api） */
@Controller('api/reminders')
export class RemindersController {
  constructor(@Inject(ReminderService) private readonly reminders: ReminderService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(): Promise<{ data: Awaited<ReturnType<ReminderService['run']>> }> {
    return { data: await this.reminders.run() };
  }
}

/** POST /api/settings/notify-test —— 向指定渠道发测试消息 */
@Controller('api/settings')
export class NotifyTestController {
  constructor(
    @Inject(NotifyDispatcher) private readonly dispatcher: NotifyDispatcher,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(NotificationsService) private readonly logs: NotificationsService,
  ) {}

  @Post('notify-test')
  @HttpCode(HttpStatus.CREATED)
  async test(@Body() body: NotifyTestRequest): Promise<{ data: { results: Record<string, { ok: boolean; error?: string }> } }> {
    const channel = body?.channel as NotifyChannel;
    if (!NOTIFY_CHANNELS.includes(channel)) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `未知渠道：${String(body?.channel)}`);
    }
    const raw = await this.settings.getRaw();
    const today = localDate(new Date());
    const result = await this.dispatcher.dispatchOne(
      channel,
      {
        itemId: 0,
        itemName: '测试物品',
        type: 'expiring_soon',
        sentDate: today,
        title: '【家庭库存】测试消息',
        body: '这是一条来自家庭库存助手的测试消息，收到即表示该渠道配置可用。',
      },
      raw,
    );
    // 2026-11-16 用户反馈「应用内通知貌似没用」：站内渠道的「送达」就是出现在通知列表，
    // inapp 测试必须真实落一条站内通知（R3 的「不写表」决策对站内渠道不成立——
    // email/wecom 测试发真实邮件可见，inapp 不写则永远看不到效果）
    if (channel === 'inapp' && result.ok) {
      this.logs.createTestNotification('【家庭库存】测试消息');
    }
    this.logs.log(
      channel,
      'info',
      result.ok
        ? `测试消息发送成功（${channel}）`
        : `测试消息发送失败（${channel}）：${result.error ?? '未知错误'}`,
    );
    return { data: { results: { [channel]: { ok: result.ok, ...(result.error ? { error: result.error } : {}) } } } };
  }
}
