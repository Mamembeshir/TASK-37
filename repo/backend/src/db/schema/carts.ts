import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { products } from './products';

// active   → in use, stock reserved
// expired  → 30-min timer elapsed; stock released by background job (task 64, Q7)
// cancelled → customer or system cancelled before checkout; stock released
// converted → successfully checked out; stock permanently decremented via order
export const cartStatusEnum = pgEnum('cart_status', [
  'active',
  'expired',
  'cancelled',
  'converted',
]);

export const carts = pgTable('carts', {
  id: uuid('id').primaryKey().defaultRandom(),

  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Set to now() + 30 minutes at creation (Q7); background job checks this field
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  status: cartStatusEnum('status').notNull().default('active'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable('cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),

  cartId: uuid('cart_id')
    .notNull()
    .references(() => carts.id, { onDelete: 'cascade' }),

  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  // Must be ≥ 1; validated at application layer via Zod
  qty: integer('qty').notNull(),

  // Timestamp when products.stock_qty was decremented for this item
  reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;
export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;
