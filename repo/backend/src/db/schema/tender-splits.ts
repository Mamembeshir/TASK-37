import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';

// Only cash and card permitted — local currency only (Q13).
// Any foreign tender is rejected at the application layer (task 77).
export const tenderMethodEnum = pgEnum('tender_method', ['cash', 'card']);

export const tenderSplits = pgTable('tender_splits', {
  id: uuid('id').primaryKey().defaultRandom(),

  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),

  method: tenderMethodEnum('method').notNull(),

  // Exact decimal — local currency only, no foreign currency (Q13)
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),

  // Card terminal receipt reference entered by staff (required for 'card', null for 'cash')
  // Validated at application layer: card splits must supply a non-empty reference (task 75)
  reference: varchar('reference', { length: 255 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenderSplit = typeof tenderSplits.$inferSelect;
export type NewTenderSplit = typeof tenderSplits.$inferInsert;
