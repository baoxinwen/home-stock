import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  API_ERROR_CODES,
  type BackupFileDto,
  type RestoreCountsDto,
  type RestoreResultDto,
} from '@home-stock/shared';
import { ApiException } from '../common/api.exception';
import type { DbHandle } from '../db/handle';

export type BackupLogLevel = 'error' | 'warn' | 'info';
export type BackupLog = (channel: string, level: BackupLogLevel, message: string) => void;

export interface BackupServiceOptions {
  /** 备份目录（BACKUP_DIR） */
  backupDir: string;
  /** 定时/安全备份保留份数（BACKUP_KEEP，默认 14；pre-restore-* 同样计入） */
  keep?: number;
  /** 备份目录总大小上限（BACKUP_MAX_BYTES，默认 2GiB；超限继续删最旧） */
  maxBytes?: number;
  log?: BackupLog;
  /** 可注入时钟，便于测试文件名/排序 */
  now?: () => Date;
}

export interface ScheduledBackupResult {
  ok: boolean;
  file?: string;
  error?: string;
}

/** 一份合法备份必须包含的业务表（规格第 5 节） */
export const REQUIRED_TABLES = [
  'categories',
  'items',
  'shopping_list_items',
  'notifications',
  'notification_logs',
  'settings',
] as const;

const SQLITE_MAGIC = Buffer.from('SQLite format 3\u0000', 'binary');
const DEFAULT_KEEP = 14;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const SCHEDULED_PREFIX = 'stock-';
const SAFETY_PREFIX = 'pre-restore-';

const defaultLog: BackupLog = (channel, level, message) => {
  const line = `[${channel}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** 本地时间文件名片段：YYYYMMDD-HHmmss（withMs 时追加 -SSS，用于安全备份防冲突） */
export function backupStamp(date = new Date(), withMs = false): string {
  const base = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return withMs ? `${base}-${pad(date.getMilliseconds(), 3)}` : base;
}

function removeSqliteSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
}

function uniquePath(dir: string, stem: string, ext: string): string {
  let candidate = join(dir, `${stem}${ext}`);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = join(dir, `${stem}-${i}${ext}`);
    i += 1;
  }
  return candidate;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fsyncFile(file: string): void {
  const fd = fs.openSync(file, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 备份/恢复核心（M8）：
 * - 快照：better-sqlite3 在线 backup API，保证 WAL 下的一致性
 * - 恢复：校验魔数 + 表结构 → 写临时文件 → 安全备份当前库 → 关闭连接 → 替换 → 重开
 * - 失败：用安全备份回滚并重开；并发恢复用进程内锁只允许一个成功
 */
export class BackupService {
  private readonly backupDir: string;
  private readonly keep: number;
  private readonly maxBytes: number;
  private readonly log: BackupLog;
  private readonly now: () => Date;
  private restoring = false;

  constructor(
    private readonly handle: DbHandle,
    options: BackupServiceOptions,
  ) {
    this.backupDir = options.backupDir;
    this.keep = normalizeKeep(options.keep);
    this.maxBytes = normalizeMaxBytes(options.maxBytes);
    this.log = options.log ?? defaultLog;
    this.now = options.now ?? (() => new Date());
  }

  /** 生成一份一致性快照到指定路径（异步 backup API）；失败时清理半成品 dest（评审 M4②） */
  async snapshotTo(dest: string): Promise<void> {
    fs.mkdirSync(dirname(dest), { recursive: true });
    try {
      await this.handle.sqlite.backup(dest);
    } catch (e) {
      // 中途失败（磁盘满等）会留下半成品 dest，被 list()/prune() 按文件名当有效备份占坑
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        // 清理失败不影响错误上报
      }
      throw e;
    }
  }

  /** 生成临时快照供浏览器下载；调用方用 cleanupDownload 清理 */
  async createDownload(): Promise<{ path: string; filename: string }> {
    const dir = fs.mkdtempSync(join(tmpdir(), 'home-stock-backup-'));
    const filename = `${SCHEDULED_PREFIX}${backupStamp(this.now())}.db`;
    const path = join(dir, filename);
    try {
      await this.snapshotTo(path);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
    return { path, filename };
  }

  cleanupDownload(path: string): void {
    try {
      fs.rmSync(dirname(path), { recursive: true, force: true });
    } catch {
      // 清理失败不影响下载
    }
  }

  /** BACKUP_DIR 下的备份列表（文件名 + 大小 + 修改时间），按时间倒序 */
  list(): BackupFileDto[] {
    if (!fs.existsSync(this.backupDir)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.backupDir, { withFileTypes: true });
    } catch {
      // BACKUP_DIR 是文件/不可读：错误路径按空列表处理，不影响应用
      return [];
    }
    const files: BackupFileDto[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.db')) continue;
      try {
        const stat = fs.statSync(join(this.backupDir, entry.name));
        files.push({ name: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() });
      } catch {
        // 单个文件读取失败（权限/竞态删除）忽略
      }
    }
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * 恢复上传的备份。
   * 顺序不可调换：校验 → 安全备份 → 关连接 → 替换 → 重开；任一步失败都回滚到安全备份。
   */
  async restore(buffer: Buffer): Promise<RestoreResultDto> {
    this.assertMagic(buffer);
    if (this.restoring) {
      throw new ApiException(
        409,
        API_ERROR_CODES.RESTORE_IN_PROGRESS,
        '已有恢复任务正在进行，请稍后重试',
      );
    }
    this.restoring = true;

    const stamp = backupStamp(this.now(), true);
    const main = this.handle.dbPath;
    // 原子替换的候选文件：写完 + fsync 后 rename 覆盖主库，避免「主库已移走、新库未就位」的窗口
    const pendingPath = `${main}.new`;
    let safety: string | null = null;
    let closed = false;
    let replaced = false;

    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      fs.writeFileSync(pendingPath, buffer);
      fsyncFile(pendingPath);
      this.assertValidSqlite(pendingPath);

      safety = uniquePath(this.backupDir, `${SAFETY_PREFIX}${stamp}`, '.db');
      await this.snapshotTo(safety);

      this.handle.close();
      closed = true;
      removeSqliteSidecars(main);
      fs.renameSync(pendingPath, main);
      replaced = true;

      this.handle.reopen();
      return { restored: this.counts(), safetyBackup: basename(safety) };
    } catch (e) {
      const rolledBack = this.rollback({ main, safety, closed, replaced });
      this.log(
        'backup',
        'error',
        `恢复备份失败：${messageOf(e)}${rolledBack ? '（已回滚到恢复前数据）' : '（自动回滚失败，请用安全备份手动恢复）'}`,
      );
      if (e instanceof ApiException) throw e;
      throw new ApiException(
        500,
        API_ERROR_CODES.RESTORE_FAILED,
        rolledBack
          ? '恢复失败，已回滚到恢复前数据'
          : '恢复失败且自动回滚未成功，请使用安全备份手动恢复',
      );
    } finally {
      this.restoring = false;
      if (fs.existsSync(pendingPath)) fs.rmSync(pendingPath, { force: true });
    }
  }

  /** 定时备份：写 BACKUP_DIR，成功后按保留份数/总量上限清理旧文件；失败只记日志不抛 */
  async runScheduledBackup(): Promise<ScheduledBackupResult> {
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const dest = uniquePath(this.backupDir, `${SCHEDULED_PREFIX}${backupStamp(this.now())}`, '.db');
      await this.snapshotTo(dest);
      this.prune();
      return { ok: true, file: basename(dest) };
    } catch (e) {
      const error = messageOf(e);
      this.log('backup', 'error', `定时备份失败：${error}`);
      return { ok: false, error };
    }
  }

  /**
   * 保留策略：`stock-*` 与 `pre-restore-*` 一起按 mtime 从新到旧保留 keep 份；
   * 之后若总大小仍超过 maxBytes，继续删最旧。keep=0 / maxBytes=0 表示全删（极值边界）。
   */
  prune(keep = this.keep): string[] {
    if (!fs.existsSync(this.backupDir)) return [];
    let names: string[];
    try {
      names = fs.readdirSync(this.backupDir);
    } catch {
      return [];
    }
    const files = names
      .filter(
        (name) =>
          (name.startsWith(SCHEDULED_PREFIX) || name.startsWith(SAFETY_PREFIX)) &&
          name.endsWith('.db'),
      )
      .map((name) => {
        try {
          const stat = fs.statSync(join(this.backupDir, name));
          return { name, mtime: stat.mtimeMs, size: stat.size };
        } catch {
          return { name, mtime: 0, size: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);

    // 从新到旧保留：份数与总大小双上限，任何一条先触发都从最旧的开始删。
    // M4①：keep>0 时最新一份无条件保底保留——单份体积超过 budget 时
    // keptBytes + size <= budget 恒假，否则会把所有备份删光（一份不剩）。
    // keep=0 仍表示全删（显式极值边界）。
    const keepCount = Math.max(0, keep);
    const budget = Math.max(0, this.maxBytes);
    let keptCount = 0;
    let keptBytes = 0;
    const toDelete: { name: string }[] = [];
    for (const [index, file] of files.entries()) {
      if ((index === 0 && keepCount > 0) || (keptCount < keepCount && keptBytes + file.size <= budget)) {
        keptCount += 1;
        keptBytes += file.size;
      } else {
        toDelete.push(file);
      }
    }

    for (const file of toDelete) {
      try {
        fs.rmSync(join(this.backupDir, file.name), { force: true });
      } catch (e) {
        this.log('backup', 'warn', `清理旧备份失败（${file.name}）：${messageOf(e)}`);
      }
    }
    return toDelete.map((f) => f.name);
  }

  private assertMagic(buffer: Buffer): void {
    if (!buffer || buffer.length === 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '请上传备份文件');
    }
    if (buffer.length < 512 || !buffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
      throw new ApiException(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        '备份文件不是有效的 SQLite 数据库',
      );
    }
  }

  /**
   * 结构校验：只读打开上传文件，quick_check + 必需表。
   * 在关闭主库之前完成，校验失败绝不触碰主库。
   */
  private assertValidSqlite(file: string): void {
    let db: Database.Database | null = null;
    try {
      db = new Database(file, { readonly: true, fileMustExist: true });
      const check = db.prepare('PRAGMA quick_check').all() as { quick_check?: string }[];
      if (check.length === 0 || check.some((row) => row.quick_check !== 'ok')) {
        throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '备份文件已损坏（quick_check 失败）');
      }
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[];
      const names = new Set(rows.map((r) => r.name));
      const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
      if (missing.length > 0) {
        throw new ApiException(
          400,
          API_ERROR_CODES.VALIDATION_ERROR,
          `备份缺少必要数据表：${missing.join(', ')}`,
        );
      }
    } catch (e) {
      if (e instanceof ApiException) throw e;
      throw new ApiException(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        `备份文件无法作为 SQLite 打开：${messageOf(e)}`,
      );
    } finally {
      try {
        db?.close();
      } catch {
        // 忽略
      }
    }
  }

  private rollback(state: {
    main: string;
    safety: string | null;
    closed: boolean;
    replaced: boolean;
  }): boolean {
    // 尚未关闭/替换主库：原数据完好，无需动作
    if (!state.closed && !state.replaced) return true;
    try {
      try {
        this.handle.close();
      } catch {
        // 已关闭
      }
      // 安全备份在关闭主库之前就写好了，是唯一可信的回滚来源
      if (state.safety && fs.existsSync(state.safety)) {
        removeSqliteSidecars(state.main);
        fs.copyFileSync(state.safety, state.main);
      }
      this.handle.reopen();
      return true;
    } catch (e) {
      this.log('backup', 'error', `回滚备份失败：${messageOf(e)}`);
      return false;
    }
  }

  private counts(): RestoreCountsDto {
    const count = (table: string): number => {
      const row = this.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
        c: number;
      };
      return row.c;
    };
    return {
      items: count('items'),
      categories: count('categories'),
      shoppingItems: count('shopping_list_items'),
      notifications: count('notifications'),
      settings: count('settings'),
    };
  }
}

function normalizeKeep(value: number | undefined): number {
  const raw = value ?? Number(process.env.BACKUP_KEEP ?? DEFAULT_KEEP);
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return DEFAULT_KEEP;
  return n;
}

function normalizeMaxBytes(value: number | undefined): number {
  const raw = value ?? Number(process.env.BACKUP_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_BYTES;
  return n;
}
