import type { Config } from 'drizzle-kit';

/**
 * drizzle-kit 配置：schema 生成/推送使用。
 * 迁移权威仍是 src/db/migrate.ts（自定义 up/down 成对脚本），
 * 本配置供后续 drizzle-kit generate 产出对照 SQL 使用。
 */
export default {
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
} satisfies Config;
