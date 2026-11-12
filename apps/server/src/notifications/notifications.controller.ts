import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import type {
  ListNotificationsQuery,
  MarkNotificationsDoneRequest,
  MarkNotificationsReadRequest,
  NotificationDto,
  NotificationLogDto,
} from '@home-stock/shared';
import { NotificationsService } from './notifications.service';

@Controller('api/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get()
  list(@Query() query: ListNotificationsQuery): { data: NotificationDto[]; unreadCount: number } {
    const unreadOnly = query.unread === 1 || (query.unread as unknown) === '1' || (query.unread as unknown) === true;
    return { data: this.service.list(unreadOnly), unreadCount: this.service.unreadCount() };
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  markRead(@Body() body: MarkNotificationsReadRequest): { data: { updated: number } } {
    return { data: this.service.markRead(body?.ids) };
  }

  /** 标记完成（0004）：ids 缺省=全部；完成同时置已读 */
  @Post('done')
  @HttpCode(HttpStatus.OK)
  markDone(@Body() body: MarkNotificationsDoneRequest): { data: { updated: number } } {
    return { data: this.service.markDone(body?.ids) };
  }

  /** 恢复到收件箱：清除 done（ids 必填） */
  @Post('undone')
  @HttpCode(HttpStatus.OK)
  undoDone(@Body() body: MarkNotificationsDoneRequest): { data: { updated: number } } {
    return { data: this.service.undoDone(body?.ids ?? []) };
  }

  @Get('logs')
  logs(): { data: NotificationLogDto[] } {
    return { data: this.service.logs() };
  }
}
