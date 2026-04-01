import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

// Offline moderation dictionary (task 93).
// Each row is either an exact-match term OR a regex pattern — never both.
//
//   is_regex = false → `term` is set; scanner does case-insensitive substring match
//   is_regex = true  → `pattern` is set; scanner compiles and tests as RegExp
//
// Application layer validates: exactly one of term/pattern is non-null (task 93).
export const bannedTerms = pgTable('banned_terms', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Exact match value (set when is_regex = false, null otherwise)
  term: varchar('term', { length: 500 }),

  // Regex pattern string (set when is_regex = true, null otherwise)
  pattern: varchar('pattern', { length: 500 }),

  isRegex: boolean('is_regex').notNull().default(false),

  // Allows disabling a term without deleting it (preserves audit history)
  isActive: boolean('is_active').notNull().default(true),

  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BannedTerm = typeof bannedTerms.$inferSelect;
export type NewBannedTerm = typeof bannedTerms.$inferInsert;
