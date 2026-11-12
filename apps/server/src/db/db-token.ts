/**
 * DB 注入 token：各 service 通过 @Inject(DB_TOKEN) 拿到 Drizzle 句柄。
 * 生产（createApp）与测试（createTestApp）各自提供对应实例。
 */
export const DB_TOKEN = 'HOME_STOCK_DB';
