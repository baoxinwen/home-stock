/**
 * 企业微信自建应用渠道（原生 fetch，不引第三方 SDK）。
 * - access_token 获取 + 内存缓存：expires_in - 120s 提前刷新
 * - 发送 text 消息给配置的 agentid + 接收人
 */
import type { Notifier, NotifierResult, NotifyJob } from './notifier';
import { fail, ok, skipped } from './notifier';
import type { RawSettings } from '../settings/settings.service';

const TOKEN_URL = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken';
const SEND_URL = 'https://qyapi.weixin.qq.com/cgi-bin/message/send';
/** 提前刷新余量（秒） */
const REFRESH_AHEAD_SECONDS = 120;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export class WecomNotifier implements Notifier {
  readonly name = 'wecom' as const;
  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly fetchImpl: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch) {}

  isEnabled(settings: RawSettings): boolean {
    return settings.wecom.enabled === 1;
  }

  async send(job: NotifyJob, settings: RawSettings): Promise<NotifierResult> {
    if (!this.isEnabled(settings)) return skipped('wecom');
    const cfg = settings.wecom;
    if (!cfg.corp_id || !cfg.secret || !cfg.agent_id) {
      return fail('wecom', new Error('企业微信渠道配置不完整：缺少 corp_id/agent_id/secret'));
    }

    try {
      const token = await this.getToken(cfg.corp_id, cfg.secret);
      if (!token) return fail('wecom', new Error('企业微信 access_token 获取失败'));

      const agentIdNum = Number(cfg.agent_id);
      const body = {
        touser: cfg.to_user || '@all',
        msgtype: 'text',
        agentid: Number.isFinite(agentIdNum) ? agentIdNum : cfg.agent_id,
        text: { content: `${job.title}\n${job.body}` },
      };
      const res = await this.fetchImpl(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { errcode?: number; errmsg?: string };
      if (data.errcode !== 0) {
        // token 失效（42001/40014）→ 清缓存，下次重取
        if (data.errcode === 42001 || data.errcode === 40014) this.cache.clear();
        return fail('wecom', new Error(`企业微信返回错误 ${data.errcode}: ${data.errmsg ?? ''}`));
      }
      return ok('wecom');
    } catch (e) {
      return fail('wecom', e);
    }
  }

  private async getToken(corpId: string, secret: string): Promise<string | null> {
    const key = `${corpId}:${secret}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAtMs > now) return hit.token;

    const url = `${TOKEN_URL}?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    const res = await this.fetchImpl(url);
    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`企业微信 gettoken 失败 ${data.errcode ?? ''}: ${data.errmsg ?? ''}`.trim());
    }
    const ttlSeconds = Math.max(0, (data.expires_in ?? 7200) - REFRESH_AHEAD_SECONDS);
    this.cache.set(key, { token: data.access_token, expiresAtMs: now + ttlSeconds * 1000 });
    return data.access_token;
  }

  /** 测试/诊断用：清空 token 缓存 */
  clearTokenCache(): void {
    this.cache.clear();
  }
}
