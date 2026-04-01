import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  numeric,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { products } from './products';

// pending         → order placed, payment not yet recorded
// confirmed       → tender splits recorded, awaiting staging
// ready_for_pickup → all pickup groups staged, code active
// pickup_locked   → 5 failed code attempts; manager override required (Q1)
// picked_up       → successfully handed off to customer
// cancelled       → cancelled; items released with reason codes
export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'confirmed',
  'ready_for_pickup',
  'pickup_locked',
  'picked_up',
  'cancelled',
]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),

  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  status: orderStatusEnum('status').notNull().default('pending'),

  // bcrypt hash of the 6-digit code displayed to customer at checkout.
  // The plain code is shown once on screen and never stored.
  pickupCode: varchar('pickup_code', { length: 255 }),

  // SHA-256(plainCode) stored as 64-char hex — deterministic, used for the
  // UNIQUE constraint.  Bcrypt uses random salts so the same code produces a
  // different hash each time; this index column makes uniqueness queryable.
  pickupCodeIndex: varchar('pickup_code_index', { length: 64 }).unique(),

  // Incremented on each failed verification attempt; locked at 5 (Q1)
  pickupAttempts: integer('pickup_attempts').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),

  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),

  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'restrict' }),

  qty: integer('qty').notNull(),

  // Price snapshot at time of order — decoupled from current products.price
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),

  // Set when item is cancelled due to out-of-stock (task 71)
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

  // Mandatory reason code when item is cancelled (spec: "cancellation with a mandatory reason code")
  cancellationReason: varchar('cancellation_reason', { length: 255 }),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
