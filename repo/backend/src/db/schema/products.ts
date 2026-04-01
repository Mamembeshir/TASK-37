import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),

  name: varchar('name', { length: 255 }).notNull(),

  description: text('description'),

  brand: varchar('brand', { length: 100 }),

  // numeric(10,2) — exact decimal for money; never use float for prices
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),

  // Current available quantity; decremented on cart reservation, incremented on release
  stockQty: integer('stock_qty').notNull().default(0),

  category: varchar('category', { length: 100 }),

  // false = soft-deleted; excluded from catalog queries (task 49)
  isActive: boolean('is_active').notNull().default(true),

  // Admin-assigned sort position for 'manual' ranking strategy (task 52).
  // Lower integers appear first; NULL = no manual rank → sorted last (NULLS LAST).
  sortOrder: integer('sort_order'),

  // search_vector tsvector GENERATED column + GIN index added via migration
  // 0007 — not declared in Drizzle schema (generated columns are read-only;
  // queried directly with sql`` in GET /products handler).
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
