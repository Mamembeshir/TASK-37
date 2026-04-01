import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// auto        → flagged by offline scanner (banned term / pattern / image hash, tasks 93-95)
// user_report → manually reported by a user (max 5/user/day enforced in task 98, Q6)
export const flagSourceEnum = pgEnum('flag_source', ['auto', 'user_report']);

// pending           → awaiting staff review
// resolved_approved → staff cleared the content (appeal won or flag dismissed)
// resolved_rejected → staff confirmed flag; content remains suppressed
export const flagStatusEnum = pgEnum('flag_status', [
  'pending',
  'resolved_approved',
  'resolved_rejected',
]);

export const moderationFlags = pgTable('moderation_flags', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Flagged entity: 'review' | 'review_image' (Q15)
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),

  source: flagSourceEnum('source').notNull(),

  // For auto flags: matched term/pattern description.
  // For user reports: reason text entered by reporter.
  reason: text('reason').notNull(),

  status: flagStatusEnum('status').notNull().default('pending'),

  // Null for auto-generated flags; set for user_report flags.
  // Used with created_at to enforce max-5-reports/user/day throttle (task 98, Q6).
  reportedBy: uuid('reported_by').references(() => users.id, { onDelete: 'set null' }),

  // Staff member who resolved the flag
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Appeals ───────────────────────────────────────────────────────────────────

export const appealStatusEnum = pgEnum('appeal_status', [
  'pending',
  'approved',
  'rejected',
]);

export const moderationAppeals = pgTable('moderation_appeals', {
  id: uuid('id').primaryKey().defaultRandom(),

  flagId: uuid('flag_id')
    .notNull()
    .references(() => moderationFlags.id, { onDelete: 'cascade' }),

  // Customer submitting the appeal
  submittedBy: uuid('submitted_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  // Customer's explanation for why the flag should be lifted
  reason: text('reason').notNull(),

  status: appealStatusEnum('status').notNull().default('pending'),

  // Associate or supervisor who reviewed the appeal (task 100)
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ModerationFlag = typeof moderationFlags.$inferSelect;
export type NewModerationFlag = typeof moderationFlags.$inferInsert;
export type ModerationAppeal = typeof moderationAppeals.$inferSelect;
export type NewModerationAppeal = typeof moderationAppeals.$inferInsert;
