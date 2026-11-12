import type Database from 'better-sqlite3';
import { createDb, type Db } from './index';

/**
 * 可重开的数据库句柄。
 *
 * 恢复备份需要「关闭连接 → 替换主库 → 重新打开」，但 Nest 里各模块持有的是同一个
 * Drizzle 句柄。这里对外暴露一个稳定的 Proxy：所有调用实时转发到当前真实句柄，
 * 恢复流程替换底层连接后，业务模块无需重新注入。
 */
export interface DbHandle {
  /** 稳定的 Drizzle 代理句柄（供各业务模块注入） */
  readonly db: Db;
  /** 当前真实 SQLite 连接 */
  readonly sqlite: Database.Database;
  readonly dbPath: string;
  /** 关闭当前连接（幂等） */
  close(): void;
  /** 按 dbPath 重新打开（会在新库上执行迁移） */
  reopen(): void;
}

function lazyDb(get: () => Db): Db {
  return new Proxy({} as Db, {
    get(_target, prop) {
      const current = get() as unknown as Record<PropertyKey, unknown>;
      const value = Reflect.get(current, prop, current);
      return typeof value === 'function' ? value.bind(current) : value;
    },
    set(_target, prop, value) {
      const current = get() as unknown as Record<PropertyKey, unknown>;
      return Reflect.set(current, prop, value);
    },
    has(_target, prop) {
      return prop in (get() as object);
    },
    ownKeys() {
      return Reflect.ownKeys(get() as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(get() as object, prop);
    },
  });
}

export class ReopenableDbHandle implements DbHandle {
  private current: Db;
  private readonly proxy: Db;

  constructor(
    readonly dbPath: string,
    initial: Db = createDb(dbPath),
  ) {
    this.current = initial;
    this.proxy = lazyDb(() => this.current);
  }

  get db(): Db {
    return this.proxy;
  }

  get sqlite(): Database.Database {
    return (this.current as unknown as { $client: Database.Database }).$client;
  }

  close(): void {
    const client = this.sqlite;
    if (client.open) client.close();
  }

  reopen(): void {
    this.current = createDb(this.dbPath);
  }
}

export function createDbHandle(dbPath: string): DbHandle {
  return new ReopenableDbHandle(dbPath);
}
