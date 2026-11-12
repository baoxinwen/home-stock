import type { INestApplication } from '@nestjs/common';
import { createApplication, type BootstrapOptions } from './bootstrap';

export { HealthController } from './health.controller';
export type CreateAppOptions = BootstrapOptions;

/**
 * 生产入口：读取 env（DATA_DIR / ACCESS_TOKEN / BACKUP_DIR / PUBLIC_DIR 等）并启动应用。
 * 定时任务（提醒/备份）在模块初始化时注册；迁移由 createDb 自动执行。
 */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  const { app } = await createApplication(options);
  return app;
}
