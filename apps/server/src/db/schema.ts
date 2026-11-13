import { sqliteTable, integer, text, real, unique } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle schema —— 与 src/db/migrate.ts 的 0001_init SQL 严格对应
 * （规格第 5 节数据模型）。迁移的权威仍是 migrate.ts（支持 down），
 * 此 schema 供运行时 drizzle-orm 类型安全查询使用。
 */

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order'),
});

export const items = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  categoryId: integer('category_id').references(() => categories.id),
  purchaseDate: text('purchase_date'),
  quantity: real('quantity').notNull().default(0),
  unit: text('unit'),
  price: real('price'),
  expiryDate: text('expiry_date'),
  opened: integer('opened').default(0),
  openedAt: text('opened_at'),
  openShelfDays: integer('open_shelf_days'),
  remindDays: integer('remind_days'),
  minQuantity: real('min_quantity'),
  status: text('status').default('active'),
  archivedReason: text('archived_reason'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  source: text('source').default('manual'),
  /** 物品图片（0006，P1 单图）：uploads/ 下文件名，NULL=无图；文件实体在 DATA_DIR/uploads/ */
  imagePath: text('image_path'),
});

export const shoppingListItems = sqliteTable('shopping_list_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  quantity: real('quantity'),
  unit: text('unit'),
  price: real('price'),
  categoryId: integer('category_id'),
  status: text('status').default('pending'),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id'),
    /** 物品名快照（0003，写入时取 items.name；物品已删/历史存量为 NULL） */
    itemName: text('item_name'),
    type: text('type'),
    sentDate: text('sent_date'),
    channels: text('channels'),
    read: integer('read').default(0),
    /** 已完成（0004，GitHub inbox done 语义）：移出收件箱；完成时同时置 read=1 */
    done: integer('done').default(0),
    createdAt: text('created_at'),
  },
  (t) => [unique('notifications_item_type_date_uq').on(t.itemId, t.type, t.sentDate)],
);

export const notificationLogs = sqliteTable('notification_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channel: text('channel'),
  level: text('level'),
  message: text('message'),
  createdAt: text('created_at'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});
