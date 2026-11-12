import 'reflect-metadata';
import { DynamicModule, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { resolveDbPath } from './db';
import { ReopenableDbHandle, type DbHandle } from './db/handle';
import { reconcileDatabaseFiles } from './db/reconcile';
import { createAccessTokenMiddleware } from './common/access-token.middleware';
import { resolveAccessToken } from './common/access-token.config';
import { ApiErrorFilter } from './common/api-error.filter';
import { pruneNotificationLogs } from './notifications/log-retention';
import { localTimestamp } from './reminders/clock';
import { HealthController } from './health.controller';
import { CategoriesModule } from './categories/categories.module';
import { ItemsModule } from './items/items.module';
import { ShoppingModule } from './shopping/shopping.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RemindersModule } from './reminders/reminders.module';
import { StatsModule } from './stats/stats.module';
import { BackupModule } from './backup/backup.module';

export interface BootstrapOptions {
  /** SQLite 主库路径；默认走 DATA_DIR/stock.db */
  dbPath?: string;
  /** 访问口令；undefined = 读 env ACCESS_TOKEN，null = 显式关闭（测试/开发） */
  accessToken?: string | null;
  /** 备份目录；默认 BACKUP_DIR 或库文件同级的 backups/ */
  backupDir?: string;
  /** 是否注册定时任务（提醒/备份）；默认 true */
  scheduler?: boolean;
  /** 前端静态目录；undefined = env PUBLIC_DIR 或 ./public，null = 不托管 */
  publicDir?: string | null;
}

interface AppModuleOptions {
  backupDir: string;
  scheduler: boolean;
}

function makeAppModule(handle: DbHandle, options: AppModuleOptions) {
  const db = handle.db;

  @Module({})
  class AppModule {
    static forRoot(): DynamicModule {
      return {
        module: AppModule,
        controllers: [HealthController],
        imports: [
          CategoriesModule.forRoot(db),
          ItemsModule.forRoot(db),
          ShoppingModule.forRoot(db),
          SettingsModule.forRoot(db),
          NotificationsModule.forRoot(db),
          RemindersModule.forRoot(db, { scheduler: options.scheduler }),
          StatsModule.forRoot(db),
          BackupModule.forRoot(handle, {
            backupDir: options.backupDir,
            scheduler: options.scheduler,
          }),
        ],
      };
    }
  }
  return AppModule;
}

/**
 * 未处理异常日志：详细堆栈只进 console + notification_logs（规格第 9 节 / 任务8 脱敏要求）。
 * 写库失败（例如恢复期间连接已关闭）时静默降级为只写 console。
 */
function createInternalErrorLogger(handle: DbHandle) {
  return (message: string): void => {
    console.error(message);
    try {
      if (handle.sqlite.open) {
        handle.sqlite
          .prepare(
            `INSERT INTO notification_logs (channel, level, message, created_at) VALUES (?, ?, ?, ?)`,
          )
          .run('api', 'error', message, localTimestamp(new Date()));
        pruneNotificationLogs(handle.sqlite);
      }
    } catch {
      // 数据库本身不可用：保留 console 日志即可
    }
  };
}

/** SPA 回退：非 /api 的 GET 页面请求交给前端路由（history 模式），静态文件由 useStaticAssets 先处理。 */
function spaFallback(publicDir: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 带扩展名的资源缺失应返回 404，而不是把 index.html 当 JS/CSS 返回
    // 大小写归一：/API/xxx 也是 API 命名空间，不能落到 SPA
    if (req.method !== 'GET' || req.path.toLowerCase().startsWith('/api') || extname(req.path)) {
      return next();
    }
    const index = join(publicDir, 'index.html');
    if (existsSync(index)) {
      res.sendFile(index);
      return;
    }
    next();
  };
}

/**
 * 应用装配（生产与测试共用）：
 * createDb（单连接）→ 可重开句柄 → Nest 模块 → 口令中间件 → 错误过滤器 → 静态资源 → init。
 */
export async function createApplication(
  options: BootstrapOptions = {},
): Promise<{ app: NestExpressApplication; handle: DbHandle }> {
  const dbPath = options.dbPath ?? resolveDbPath();

  // I1 fail-closed：空口令仅限 NODE_ENV=development/test；生产缺口令在启动即失败（含 trim/最小长度校验）。
  // 必须放在打开数据库之前：配置非法时不产生任何文件副作用（启动真正失败，而非留下半初始化资源）。
  const accessToken = resolveAccessToken({ accessToken: options.accessToken });

  // I2：崩溃窗口对账；主库缺失时先回滚，绝不让 createDb 静默建空库
  const reconcile = reconcileDatabaseFiles(dbPath);
  for (const message of reconcile.messages) console.warn(`[startup] ${message}`);
  if (reconcile.action === 'error') {
    throw new Error(reconcile.messages.join('；') || '数据库不可用：启动中止');
  }

  const handle = new ReopenableDbHandle(dbPath);
  if (reconcile.messages.length > 0) {
    try {
      const stmt = handle.sqlite.prepare(
        `INSERT INTO notification_logs (channel, level, message, created_at) VALUES (?, ?, ?, ?)`,
      );
      for (const message of reconcile.messages) {
        stmt.run('startup', 'warn', message, localTimestamp(new Date()));
      }
      pruneNotificationLogs(handle.sqlite); // 与其他写入点一致：写后即清（M6 收尾）
    } catch {
      // 启动告警已经写 console；DB 不可写时不再影响启动
    }
  }
  const backupDir = options.backupDir ?? process.env.BACKUP_DIR ?? join(dirname(dbPath), 'backups');
  const publicDir =
    options.publicDir === undefined ? (process.env.PUBLIC_DIR ?? resolve('public')) : options.publicDir;

  const app = await NestFactory.create<NestExpressApplication>(
    makeAppModule(handle, { backupDir, scheduler: options.scheduler !== false }).forRoot(),
    {
      logger: process.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
      abortOnError: false,
    },
  );

  // 挂在 /api 命名空间下：Express 挂载路径匹配大小写不敏感，/API/items 同样受保护；
  // 前端静态资源与 SPA 回退不在 /api 下，天然豁免（登录页可加载）
  app.use('/api', createAccessTokenMiddleware(accessToken));
  app.useGlobalFilters(new ApiErrorFilter(createInternalErrorLogger(handle)));

  if (publicDir && existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
    app.use(spaFallback(publicDir));
  }

  await app.init();
  return { app, handle };
}
