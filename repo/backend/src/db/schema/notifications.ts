import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// In-app notifications only — no email or SMS ever sent (spec, task 121).
// Inserted by backend whenever a ticket status changes (task 118).
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),

  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  message: text('message').notNull(),

  // Allows frontend to render a deep-link to the relevant entity (e.g. ticket detail page)
  entityType: varchar('entity_type', { length: 50 }),  // e.g. 'ticket', 'order'
  entityId: uuid('entity_id'),

  isRead: boolean('is_read').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
