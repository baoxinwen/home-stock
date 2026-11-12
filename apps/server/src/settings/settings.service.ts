/**
 * 设置模块：settings 表键值 ↔ 结构化 SettingsDto。
 * 秘密字段（email.pass / wecom.secret）GET 脱敏为 ***，PUT 传 *** 保持原值。
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import {
  API_ERROR_CODES,
  SECRET_MASK,
  type EmailChannelSettings,
  type SettingsDto,
  type SettingsUpdateDto,
  type WecomChannelSettings,
} from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { settings } from '../db/schema';
import { ApiException } from '../common/api.exception';

export interface EmailRawSettings {
  enabled: number;
  smtp_host: string | null;
  smtp_port: number | null;
  secure: number;
  user: string | null;
  pass: string | null;
  from: string | null;
  to: string | null;
}

export interface WecomRawSettings {
  enabled: number;
  corp_id: string | null;
  agent_id: string | null;
  secret: string | null;
  to_user: string | null;
}

export interface RawSettings {
  default_remind_days: number;
  reminder_hour: number;
  auto_archive_expired: number;
  /** 应用内渠道开关（默认启用；M7.3） */
  inapp: { enabled: number };
  email: EmailRawSettings;
  wecom: WecomRawSettings;
}

export const DEFAULT_SETTINGS: RawSettings = {
  default_remind_days: 3,
  reminder_hour: 8,
  auto_archive_expired: 1,
  inapp: { enabled: 1 },
  email: {
    enabled: 0, smtp_host: null, smtp_port: null, secure: 0, user: null, pass: null, from: null, to: null,
  },
  wecom: { enabled: 0, corp_id: null, agent_id: null, secret: null, to_user: null },
};

/** 白名单（扁平键 → 所属分组），未知字段忽略 */
const INT_KEYS = ['default_remind_days', 'reminder_hour', 'auto_archive_expired'] as const;

/** M5：提醒扫描最后成功运行日期（YYYY-MM-DD），settings kv 内部记录键（不进 SettingsDto/白名单） */
const REMINDER_LAST_RUN_KEY = 'reminder_last_run_date';
const EMAIL_STR_KEYS = ['smtp_host', 'user', 'pass', 'from', 'to'] as const;
const EMAIL_INT_KEYS = ['enabled', 'smtp_port', 'secure'] as const;
const WECOM_STR_KEYS = ['corp_id', 'agent_id', 'secret', 'to_user'] as const;
const WECOM_INT_KEYS = ['enabled'] as const;

const SECRET_KEYS = new Set(['email.pass', 'wecom.secret']);

/**
 * 进程内设置变更事件总线（模块可能有多个 SettingsService 实例，用模块级总线保证
 * 调度器等订阅方都能收到变更；单进程自托管场景足够）。
 */
export const settingsBus = new EventEmitter();
settingsBus.setMaxListeners(50);

@Injectable()
export class SettingsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async getRaw(): Promise<RawSettings> {
    const rows = this.db.select().from(settings).all();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const result: RawSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // 数值字段按 key 判定（不能看默认值类型：email.smtp_port 默认 null，否则会回读成字符串 "465"）
    const apply = (prefix: string, target: Record<string, unknown>, numericKeys: readonly string[]) => {
      for (const k of Object.keys(target)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (!map.has(full)) continue;
        const v = map.get(full) as string | null;
        if (numericKeys.includes(k)) {
          const n = v == null || v === '' ? NaN : Number(v);
          target[k] = Number.isFinite(n) ? n : target[k];
        } else {
          target[k] = v;
        }
      }
    };
    apply('', result as unknown as Record<string, unknown>, ['default_remind_days', 'reminder_hour', 'auto_archive_expired']);
    apply('email', result.email as unknown as Record<string, unknown>, ['enabled', 'smtp_port', 'secure']);
    apply('wecom', result.wecom as unknown as Record<string, unknown>, ['enabled']);
    apply('inapp', result.inapp as unknown as Record<string, unknown>, ['enabled']);
    return result;
  }

  async getMasked(): Promise<SettingsDto> {
    const raw = await this.getRaw();
    return {
      default_remind_days: raw.default_remind_days,
      reminder_hour: raw.reminder_hour,
      auto_archive_expired: raw.auto_archive_expired,
      email: { ...raw.email, pass: raw.email.pass == null ? null : SECRET_MASK },
      wecom: { ...raw.wecom, secret: raw.wecom.secret == null ? null : SECRET_MASK },
    };
  }

  /** M5：读取提醒扫描最后成功运行日期；无记录（首次启动）返回 null */
  async getReminderLastRunDate(): Promise<string | null> {
    const rows = this.db.select().from(settings).where(eq(settings.key, REMINDER_LAST_RUN_KEY)).all();
    return rows.length > 0 ? (rows[0].value ?? null) : null;
  }

  /**
   * M5：写入提醒扫描最后成功运行日期（ReminderService.scan 成功后调用）。
   * 纯内部 kv 记录：直接写库、不 emit settingsBus 'updated'——避免调度器收到事件后
   * 重建任务形成无意义的循环重建。
   */
  async setReminderLastRunDate(date: string): Promise<void> {
    this.db
      .insert(settings)
      .values({ key: REMINDER_LAST_RUN_KEY, value: date })
      .onConflictDoUpdate({ target: settings.key, set: { value: date } })
      .run();
  }

  async update(patch: SettingsUpdateDto): Promise<SettingsDto> {
    const current = await this.getRaw();

    // 校验标量
    if (patch.default_remind_days !== undefined) {
      const v = patch.default_remind_days;
      if (!Number.isInteger(v) || v <= 0) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'default_remind_days 必须为正整数');
      }
    }
    if (patch.reminder_hour !== undefined) {
      const v = patch.reminder_hour;
      if (!Number.isInteger(v) || v < 0 || v > 23) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'reminder_hour 必须为 0-23 的整数');
      }
    }
    if (patch.auto_archive_expired !== undefined) {
      if (patch.auto_archive_expired !== 0 && patch.auto_archive_expired !== 1) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'auto_archive_expired 只能为 0 或 1');
      }
    }
    if (patch.email) this.validateEmail(patch.email);
    if (patch.wecom) this.validateWecom(patch.wecom);

    const writes: { key: string; value: string | null }[] = [];
    for (const k of INT_KEYS) {
      if (patch[k] !== undefined) writes.push({ key: k, value: String(patch[k]) });
    }
    if (patch.email) {
      for (const k of EMAIL_STR_KEYS) {
        const v = patch.email[k];
        if (v === undefined) continue;
        writes.push({ key: `email.${k}`, value: v });
      }
      for (const k of EMAIL_INT_KEYS) {
        const v = patch.email[k];
        if (v === undefined) continue;
        writes.push({ key: `email.${k}`, value: String(v) });
      }
    }
    if (patch.wecom) {
      for (const k of WECOM_STR_KEYS) {
        const v = patch.wecom[k];
        if (v === undefined) continue;
        writes.push({ key: `wecom.${k}`, value: v });
      }
      for (const k of WECOM_INT_KEYS) {
        const v = patch.wecom[k];
        if (v === undefined) continue;
        writes.push({ key: `wecom.${k}`, value: String(v) });
      }
    }

    // 秘密字段 *** → 保持原值（丢弃该写入）
    for (const full of SECRET_KEYS) {
      const w = writes.find((x) => x.key === full);
      if (w && (w.value === SECRET_MASK || w.value == null)) w.value = undefined as unknown as string | null;
    }
    const finalWrites = writes.filter((w) => w.value !== undefined);

    // M9：多键写入包事务——逐键裸跑时中途崩溃会留下半更新配置
    //（如 email.host 改了 port 没改）。同库 shopping.service.convert 已有 transaction 先例。
    this.db.transaction((tx) => {
      for (const w of finalWrites) {
        const exists = tx.select().from(settings).where(eq(settings.key, w.key)).all();
        if (exists.length) {
          tx.update(settings).set({ value: w.value }).where(eq(settings.key, w.key)).run();
        } else {
          tx.insert(settings).values({ key: w.key, value: w.value }).run();
        }
      }
    });

    // 通知订阅方（调度器按新的 reminder_hour 重建任务）
    settingsBus.emit('updated', finalWrites.map((w) => w.key));

    return this.getMasked();
  }

  private validateEmail(email: SettingsUpdateDto['email']): void {
    if (!email) return;
    for (const k of EMAIL_INT_KEYS) {
      const v = email[k];
      if (v === undefined || v === null) continue;
      if (!Number.isInteger(v) || (k === 'enabled' || k === 'secure' ? v !== 0 && v !== 1 : v < 0 || v > 65535)) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `email.${k} 非法`);
      }
    }
    for (const k of EMAIL_STR_KEYS) {
      const v = email[k];
      if (v === undefined) continue;
      if (v !== null && typeof v !== 'string') {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `email.${k} 必须为字符串或 null`);
      }
    }
  }

  private validateWecom(wecom: SettingsUpdateDto['wecom']): void {
    if (!wecom) return;
    for (const k of WECOM_INT_KEYS) {
      const v = wecom[k];
      if (v === undefined || v === null) continue;
      if (v !== 0 && v !== 1) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `wecom.${k} 只能为 0 或 1`);
      }
    }
    for (const k of WECOM_STR_KEYS) {
      const v = wecom[k];
      if (v === undefined) continue;
      if (v !== null && typeof v !== 'string') {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, `wecom.${k} 必须为字符串或 null`);
      }
    }
  }
}
