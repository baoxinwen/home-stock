/**
 * notification_logs 保留上限（评审 M6）：日志有 3 处写入路径
 * （NotificationsService.log、bootstrap 内部错误日志、backup 模块日志），
 * 只插不清会无限膨胀。每次写入后调用本函数，保留最近 keep 条、删除更旧的。
 *
 * 清理失败静默降级：日志是可观测性设施，不能反过来影响业务主流程。
 */
export const NOTIFICATION_LOG_KEEP = 500;

export type SqliteLike = {
  prepare(sql: string): { run(...params: unknown[]): unknown };
};

export function pruneNotificationLogs(sqlite: SqliteLike, keep: number = NOTIFICATION_LOG_KEEP): void {
  try {
    sqlite
      .prepare(
        `DELETE FROM notification_logs WHERE id NOT IN (SELECT id FROM notification_logs ORDER BY id DESC LIMIT ?)`,
      )
      .run(keep);
  } catch {
    // 清理失败不影响主流程
  }
}
