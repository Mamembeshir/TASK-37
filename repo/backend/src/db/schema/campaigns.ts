import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// Ranking strategies available for the recommendation panel (task 52)
export const recommendationStrategyEnum = pgEnum('recommendation_strategy', [
  'popularity',
  'price_asc',
  'price_desc',
  'newest',
  'manual',
]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Store identifier — varchar supports single-store and future multi-location setups
  storeId: varchar('store_id', { length: 100 }).notNull(),

  // A/B variant label shown in the UI, e.g. 'A', 'B', 'Control'
  variant: varchar('variant', { length: 50 }).notNull(),

  strategy: recommendationStrategyEnum('strategy').notNull(),

  // Date-only (no time) — matches spec "by store or date range" (Q5)
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),

  // false = deactivated by admin; backend overlap check queries active rows (task 55, Q5)
  // Only one active campaign per store per overlapping date range is permitted.
  isActive: boolean('is_active').notNull().default(true),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
