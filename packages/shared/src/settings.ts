/**
 * Task5 追加契约：settings / notifications / reminders（packages/shared 单一来源）。
 */

// ---------- 通知类型 ----------
export const NOTIFICATION_TYPES = ['expiring_soon', 'expired'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFY_CHANNELS = ['email', 'wecom', 'inapp'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

// ---------- 通知（应用内） ----------
export interface NotificationDto {
  id: number;
  itemId: number | null;
  /** 物品名快照（写入时从 items.name 取）；物品已删或历史迁移存量可能为 null */
  itemName: string | null;
  type: NotificationType | null;
  sentDate: string | null;
  channels: string | null;
  read: number;
  /** 已完成（0004，GitHub inbox done 语义）：移出收件箱；完成时 server 同时置 read=1 */
  done: number;
  createdAt: string | null;
}

/** GET /notifications?unread=1 */
export interface ListNotificationsQuery {
  unread?: number;
}

/** POST /notifications/read 请求体；ids 缺省 = 全部标记已读 */
export interface MarkNotificationsReadRequest {
  ids?: number[];
}

/** POST /notifications/done 请求体；ids 缺省 = 全部完成 */
export interface MarkNotificationsDoneRequest {
  ids?: number[];
}

/** GET /notifications/logs */
export interface NotificationLogDto {
  id: number;
  channel: NotifyChannel | null;
  level: string | null;
  message: string | null;
  createdAt: string | null;
}

// ---------- 设置 ----------
/** 秘密字段在 GET 响应中脱敏为该占位符；PUT 传该占位符表示“保持原值不变” */
export const SECRET_MASK = '***';

export interface EmailChannelSettings {
  enabled: number;
  smtp_host: string | null;
  smtp_port: number | null;
  secure: number;
  user: string | null;
  /** GET 恒为 SECRET_MASK 或 null；PUT 传 SECRET_MASK 表示保持原值 */
  pass: string | null;
  from: string | null;
  to: string | null;
}

export interface WecomChannelSettings {
  enabled: number;
  corp_id: string | null;
  agent_id: string | null;
  /** GET 恒为 SECRET_MASK 或 null；PUT 传 SECRET_MASK 表示保持原值 */
  secret: string | null;
  to_user: string | null;
}

export interface SettingsDto {
  default_remind_days: number;
  reminder_hour: number;
  auto_archive_expired: number;
  email: EmailChannelSettings;
  wecom: WecomChannelSettings;
}

/** 部分更新（白名单字段，未知字段忽略）；秘密字段传 SECRET_MASK 保持原值 */
export interface SettingsUpdateDto {
  default_remind_days?: number;
  reminder_hour?: number;
  auto_archive_expired?: number;
  email?: Partial<Omit<EmailChannelSettings, 'pass'>> & { pass?: string | null };
  wecom?: Partial<Omit<WecomChannelSettings, 'secret'>> & { secret?: string | null };
}

// ---------- 提醒 ----------
/** 单个渠道在本次扫描中的聚合结果（按物品累计，不是最后一条覆盖） */
export interface ReminderRunChannelResult {
  ok: boolean;
  /** 成功送达的物品数 */
  sent: number;
  /** 失败的物品数 */
  failed: number;
  /** 最近一次失败原因 */
  error?: string;
}

/** POST /reminders/run 响应 */
export interface ReminderRunResult {
  /** 本次扫描新产生的通知数（去重后实际送达的物品数） */
  notified: number;
  /** 自动归档的物品数 */
  archived: number;
  /** 各渠道聚合结果：channel -> { ok, sent, failed, error? } */
  channels: Record<string, ReminderRunChannelResult>;
}

/** POST /settings/notify-test 请求体 */
export interface NotifyTestRequest {
  channel: NotifyChannel;
}

/** POST /settings/notify-test 响应 */
export interface NotifyTestResult {
  results: Record<string, { ok: boolean; error?: string }>;
}
