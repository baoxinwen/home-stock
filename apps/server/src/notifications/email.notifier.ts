/**
 * 邮件渠道：nodemailer SMTP。transport 可注入（测试用 mock transport 断言载荷）。
 * 单次发送失败 → { ok:false, error }，不抛出。
 */
import { createTransport, type Transporter } from 'nodemailer';
import type { Notifier, NotifierResult, NotifyJob } from './notifier';
import { fail, ok, skipped } from './notifier';
import type { RawSettings } from '../settings/settings.service';

export type TransportFactory = (options: Record<string, unknown>) => Pick<Transporter, 'sendMail'>;

export class EmailNotifier implements Notifier {
  readonly name = 'email' as const;

  constructor(private readonly createTransportImpl: TransportFactory = createTransport as unknown as TransportFactory) {}

  isEnabled(settings: RawSettings): boolean {
    return settings.email.enabled === 1;
  }

  async send(job: NotifyJob, settings: RawSettings): Promise<NotifierResult> {
    if (!this.isEnabled(settings)) return skipped('email');

    const cfg = settings.email;
    const missing = (
      [
        ['smtp_host', cfg.smtp_host],
        ['smtp_port', cfg.smtp_port],
        ['from', cfg.from],
        ['to', cfg.to],
      ] as const
    )
      .filter(([, v]) => v == null || v === '')
      .map(([k]) => k);
    if (missing.length) {
      return fail('email', new Error(`邮件渠道配置不完整：缺少 ${missing.join('/')}`));
    }

    try {
      const transporter = this.createTransportImpl({
        host: cfg.smtp_host,
        port: cfg.smtp_port,
        secure: cfg.secure === 1,
        ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? '' } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      await transporter.sendMail({
        from: cfg.from as string,
        to: cfg.to as string,
        subject: job.title,
        text: job.body,
      });
      return ok('email');
    } catch (e) {
      return fail('email', e);
    }
  }
}
