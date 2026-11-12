/**
 * 访问口令配置（M9.2 / Fix Round 1 I1）：
 * - 仅 NODE_ENV 显式为 development/test 时允许空口令（开发/测试便利）
 * - 其他环境（production / 未设置）fail-closed：启动即失败
 * - 配置了口令时 trim，且要求最小长度，避免空白/极短口令
 */
export const MIN_ACCESS_TOKEN_LENGTH = 8;

export class AccessTokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessTokenConfigError';
  }
}

export interface ResolveAccessTokenOptions {
  /** undefined = 读 env ACCESS_TOKEN；null = 显式关闭（仅限 development/test） */
  accessToken?: string | null;
}

export function normalizeAccessToken(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function allowsEmptyAccessToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

export function resolveAccessToken(
  options: ResolveAccessTokenOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = options.accessToken === undefined ? env.ACCESS_TOKEN : options.accessToken;
  const token = normalizeAccessToken(raw);

  if (!token) {
    if (!allowsEmptyAccessToken(env)) {
      throw new AccessTokenConfigError(
        `ACCESS_TOKEN 未配置或为空白：生产环境必须设置访问口令（NODE_ENV=${env.NODE_ENV ?? 'undefined'} 不允许留空）`,
      );
    }
    return null;
  }

  if (token.length < MIN_ACCESS_TOKEN_LENGTH) {
    throw new AccessTokenConfigError(
      `ACCESS_TOKEN 过短：至少需要 ${MIN_ACCESS_TOKEN_LENGTH} 位（当前 ${token.length} 位）`,
    );
  }
  return token;
}
