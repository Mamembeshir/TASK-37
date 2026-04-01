import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * One row per active session.  tokenHash is HMAC-SHA256(SESSION_SECRET, rawToken)
 * so a DB read alone cannot be replayed without the application secret.
 * Sessions are deleted on logout (task 34) or swept by expiry.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),

  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // HMAC-SHA256(SESSION_SECRET, rawToken) — 64 hex chars
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
