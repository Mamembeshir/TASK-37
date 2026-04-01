import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

// Blocklist of SHA-256 hashes of flagged review images.
// On every image upload, the hash of the incoming file is checked against
// this table; a match causes immediate rejection (task 89, Q15).
// Rows are never deleted — the blocklist is permanent unless explicitly
// cleared by an admin (which would require an audit log entry).
export const imageHashes = pgTable('image_hashes', {
  id: uuid('id').primaryKey().defaultRandom(),

  // SHA-256 hex digest (64 chars); unique so duplicate entries are impossible
  sha256: varchar('sha256', { length: 64 }).notNull().unique(),

  // Staff member who triggered the flag (via moderation resolution, task 96)
  flaggedBy: uuid('flagged_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  flaggedAt: timestamp('flagged_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ImageHash = typeof imageHashes.$inferSelect;
export type NewImageHash = typeof imageHashes.$inferInsert;
