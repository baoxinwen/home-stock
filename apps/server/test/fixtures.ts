/**
 * 测试夹具：构造 RawSettings（带深合并），避免每个用例重复写全字段。
 */
import { DEFAULT_SETTINGS, type RawSettings } from '../src/settings/settings.service';

export interface SettingsOverrides {
  default_remind_days?: number;
  reminder_hour?: number;
  auto_archive_expired?: number;
  inappEnabled?: boolean;
  email?: Partial<RawSettings['email']>;
  wecom?: Partial<RawSettings['wecom']>;
}

export function notifierSettings(o: SettingsOverrides = {}): RawSettings {
  const base: RawSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (o.default_remind_days !== undefined) base.default_remind_days = o.default_remind_days;
  if (o.reminder_hour !== undefined) base.reminder_hour = o.reminder_hour;
  if (o.auto_archive_expired !== undefined) base.auto_archive_expired = o.auto_archive_expired;
  if (o.email) base.email = { ...base.email, ...o.email } as RawSettings['email'];
  if (o.wecom) base.wecom = { ...base.wecom, ...o.wecom } as RawSettings['wecom'];
  // inapp 开关：落在 settings 表的 inapp.enabled（默认启用，见 DefaultSettings）
  (base as unknown as { inapp: { enabled: number } }).inapp = { enabled: o.inappEnabled === false ? 0 : 1 };
  return base;
}
