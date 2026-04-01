import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { orderItems } from './orders';

// pending   → created, items being assigned, reassignment allowed (Q2)
// staged    → inventory physically staged; item reassignment now BLOCKED (Q2)
// picked_up → customer collected all items in this group
// cancelled → group cancelled (e.g. all items out of stock)
export const pickupGroupStatusEnum = pgEnum('pickup_group_status', [
  'pending',
  'staged',
  'picked_up',
  'cancelled',
]);

export const pickupGroups = pgTable('pickup_groups', {
  id: uuid('id').primaryKey().defaultRandom(),

  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),

  // Department where this group is staged, e.g. 'front_desk', 'fulfillment', 'warehouse'
  department: varchar('department', { length: 100 }).notNull(),

  // Once 'staged', backend rejects any item reassignment to/from this group (task 67)
  status: pickupGroupStatusEnum('status').notNull().default('pending'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pickupGroupItems = pgTable('pickup_group_items', {
  id: uuid('id').primaryKey().defaultRandom(),

  pickupGroupId: uuid('pickup_group_id')
    .notNull()
    .references(() => pickupGroups.id, { onDelete: 'cascade' }),

  // Links to order_items (not products) to preserve unit_price snapshot
  orderItemId: uuid('order_item_id')
    .notNull()
    .unique() // An order item belongs to exactly one pickup group at a time
    .references(() => orderItems.id, { onDelete: 'cascade' }),

  // Timestamp of the most recent assignment; updated on reassignment before staging (Q2)
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PickupGroup = typeof pickupGroups.$inferSelect;
export type NewPickupGroup = typeof pickupGroups.$inferInsert;
export type PickupGroupItem = typeof pickupGroupItems.$inferSelect;
export type NewPickupGroupItem = typeof pickupGroupItems.$inferInsert;
