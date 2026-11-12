import * as fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';

export type ReconcileAction =
  | 'none'
  | 'restored-old'
  | 'removed-pending'
  | 'recovered-pending'
  | 'kept-main'
  | 'error';

export interface ReconcileResult {
  action: ReconcileAction;
  messages: string[];
  restoredFrom?: string;
}

const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

function removeSidecars(file: string): void {
  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecar = `${file}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
  }
}

/** 把属于旧文件的 sidecar 一起搬到新位置（旧库可能还有未 checkpoint 的 WAL） */
function adoptSidecars(from: string, to: string): void {
  for (const suffix of SIDECAR_SUFFIXES) {
    const source = `${from}${suffix}`;
    if (!fs.existsSync(source)) continue;
    const target = `${to}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    fs.renameSync(source, target);
  }
}

/** 删除一份旧库文件连同它的 sidecar */
function removeDbFile(file: string): void {
  removeSidecars(file);
  fs.rmSync(file, { force: true });
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
 * 只读打开并 quick_check，判断一份库文件是否完整可用。
 *
 * 注意：只读打开 WAL 模式的库会让 SQLite 顺手建 `-shm` / 空 `-wal`。
 * 这里只清理「本次检查新建的、且内容为空」的 sidecar，绝不碰调用前就已存在的文件，
 * 避免误删含数据的 WAL。
 */
export function isIntactSqlite(file: string): boolean {
  const preexisting = SIDECAR_SUFFIXES.map((suffix) => fs.existsSync(`${file}${suffix}`));
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare('PRAGMA quick_check').all() as { quick_check?: string }[];
    return rows.length > 0 && rows.every((row) => row.quick_check === 'ok');
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
    SIDECAR_SUFFIXES.forEach((suffix, index) => {
      if (preexisting[index]) return;
      const sidecar = `${file}${suffix}`;
      try {
        if (fs.existsSync(sidecar) && fs.statSync(sidecar).size === 0) fs.rmSync(sidecar, { force: true });
      } catch {
        // 清理失败不影响对账结论
      }
    });
  }
}

interface OldFile {
  name: string;
  path: string;
  mtime: number;
}

function oldFiles(dbPath: string): OldFile[] {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.old-`;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && !name.endsWith('-wal') && !name.endsWith('-shm'))
    .map((name) => {
      const path = join(dir, name);
      try {
        return { name, path, mtime: fs.statSync(path).mtimeMs };
      } catch {
        return { name, path, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * 启动时对账（Fix Round 1 I2）：
 * - 主库缺失 + `.old-*` 残留：回滚最新且完整的旧库（绝不静默新建空库）
 * - 主库缺失 + 完整 `.new`：把待替换文件提升为主库
 * - 主库存在 + `.new` 残留：删除未完成的替换文件
 * - 主库存在 + `.old-*` 且主库完整：保留主库、清理残留并告警
 * - 主库存在但损坏 + `.old-*`：用旧库覆盖回滚
 * - 主库缺失且没有可用副本：error（由启动流程抛出，避免空库运行）
 */
export function reconcileDatabaseFiles(dbPath: string): ReconcileResult {
  const messages: string[] = [];
  const pending = `${dbPath}.new`;
  const olds = oldFiles(dbPath);
  const pendingExists = fs.existsSync(pending);
  const mainExists = fs.existsSync(dbPath);

  if (!mainExists) {
    const validOld = olds.find((old) => isIntactSqlite(old.path));
    if (validOld) {
      removeSidecars(dbPath);
      fs.renameSync(validOld.path, dbPath);
      adoptSidecars(validOld.path, dbPath);
      for (const old of olds) {
        if (old.path !== validOld.path) removeDbFile(old.path);
      }
      if (pendingExists) removeDbFile(pending);
      messages.push(`检测到主库缺失：已从旧库残留 ${validOld.name} 自动回滚`);
      return { action: 'restored-old', messages, restoredFrom: validOld.name };
    }
    if (pendingExists) {
      if (isIntactSqlite(pending)) {
        removeSidecars(dbPath);
        fs.renameSync(pending, dbPath);
        adoptSidecars(pending, dbPath);
        for (const old of olds) removeDbFile(old.path);
        messages.push('检测到主库缺失：已将完整的待替换文件 .new 提升为主库');
        return { action: 'recovered-pending', messages, restoredFrom: basename(pending) };
      }
      messages.push('主库缺失，且 .new 不是可用的 SQLite 库；拒绝新建空库启动');
      return { action: 'error', messages };
    }
    // 全新安装：没有主库、也没有任何恢复副本。
    // 到这里若仍有 .old-* 残留，说明它们全部损坏（validOld 已排除）——数据不可救，
    // 按全新安装放行建空库，但必须告警，避免静默丢数据无人知晓。
    if (olds.length > 0) {
      messages.push('主库缺失，且历史残留的旧库文件均已损坏；按全新安装处理，将创建空库');
    }
    return { action: 'none', messages };
  }

  let action: ReconcileAction = 'none';

  if (pendingExists) {
    removeDbFile(pending);
    messages.push('清理未完成替换的 .new 残留（主库保持可用）');
    action = 'removed-pending';
  }

  if (olds.length > 0) {
    if (isIntactSqlite(dbPath)) {
      for (const old of olds) removeDbFile(old.path);
      messages.push(`检测到 ${olds.length} 份旧库残留；主库完整，已保留主库并清理残留`);
      if (action === 'none') action = 'kept-main';
    } else {
      const validOld = olds.find((old) => isIntactSqlite(old.path));
      if (!validOld) {
        messages.push('主库损坏，且旧库残留均不可用；拒绝启动');
        return { action: 'error', messages };
      }
      removeSidecars(dbPath);
      fs.copyFileSync(validOld.path, dbPath);
      // 旧库可能还有未 checkpoint 的 WAL：一起带过来，否则会丢最近的数据
      for (const suffix of SIDECAR_SUFFIXES) {
        const sidecar = `${validOld.path}${suffix}`;
        if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${dbPath}${suffix}`);
      }
      fsyncFile(dbPath);
      for (const old of olds) removeDbFile(old.path);
      messages.push(`检测到主库损坏：已用旧库 ${validOld.name} 覆盖回滚`);
      action = 'restored-old';
    }
  }

  return { action, messages };
}
