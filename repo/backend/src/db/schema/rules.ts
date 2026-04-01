import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// draft      → being edited, not yet evaluated
// active     → published and evaluated by the rules engine
// inactive   → manually deactivated by admin
// rolled_back → replaced by a prior version via one-click rollback (task 128, Q10)
export const ruleStatusEnum = pgEnum('rule_status', [
  'draft',
  'active',
  'inactive',
  'rolled_back',
]);

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Human-readable identifier, unique across all rule sets
  name: varchar('name', { length: 255 }).notNull().unique(),

  // Monotonically incremented on every PUT; starts at 1 (task 126)
  version: integer('version').notNull().default(1),

  status: ruleStatusEnum('status').notNull().default('draft'),

  // Full rule definition — structure formalised in task 122 (/shared schema).
  // Supports: conditions, actions, priority, grouping,
  // evaluation_mode (serial|parallel), allowlists, denylists, thresholds.
  definitionJson: jsonb('definition_json').notNull(),

  // Required on every create or update (spec: "any rule change requires an admin comment")
  adminComment: text('admin_comment').notNull(),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  // Set when status transitions to 'active' (task 127)
  publishedAt: timestamp('published_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Snapshot of each version before it is overwritten.
// Used by one-click rollback (task 128) to restore a prior published version.
// Rows are never deleted — rollback history must be preserved (Q10).
export const rulesHistory = pgTable('rules_history', {
  id: uuid('id').primaryKey().defaultRandom(),

  ruleId: uuid('rule_id')
    .notNull()
    .references(() => rules.id, { onDelete: 'cascade' }),

  // The version number being archived
  version: integer('version').notNull(),

  status: ruleStatusEnum('status').notNull(),

  // Full definition snapshot at this version
  definitionJson: jsonb('definition_json').notNull(),

  // Admin comment that accompanied this version
  adminComment: text('admin_comment').notNull(),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  publishedAt: timestamp('published_at', { withTimezone: true }),

  // When this version was archived (i.e. superseded by a newer version)
  archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
export type RuleHistory = typeof rulesHistory.$inferSelect;
export type NewRuleHistory = typeof rulesHistory.$inferInsert;
