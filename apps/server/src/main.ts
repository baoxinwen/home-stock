import { createApp } from './app';

async function bootstrap(): Promise<void> {
  try {
    const app = await createApp();
    // 容器收到 SIGTERM 时停止 cron（提醒/备份），避免重建容器期间的任务重叠
    app.enableShutdownHooks();
    // 端口可环境变量覆盖（默认 3000）：宿主 3000 被占时 e2e 可换端口跑
    await app.listen(Number(process.env.PORT ?? 3000));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

void bootstrap();
