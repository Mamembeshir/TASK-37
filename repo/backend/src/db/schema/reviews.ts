import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { users } from './users';

// pending  → submitted, awaiting offline moderation scan (task 93)
// approved → passed moderation (or appeal resolved in favour)
// flagged  → matched banned term / pattern / image hash (task 95)
export const reviewModerationStatusEnum = pgEnum('review_moderation_status', [
  'pending',
  'approved',
  'flagged',
]);

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),

  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'restrict' }),

  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  body: text('body').notNull(),

  // true = this is a follow-up to an existing review (Q4)
  isFollowup: boolean('is_followup').notNull().default(false),

  // Set only when isFollowup = true; points to the original review.
  // Application layer enforces: one follow-up per original, within 14 days (Q4).
  parentReviewId: uuid('parent_review_id'),

  moderationStatus: reviewModerationStatusEnum('moderation_status')
    .notNull()
    .default('pending'),

  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviewImages = pgTable('review_images', {
  id: uuid('id').primaryKey().defaultRandom(),

  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),

  // Original filename as uploaded by the customer
  originalName: varchar('original_name', { length: 255 }).notNull(),

  // Path to file in UPLOAD_DIR on the local server
  storagePath: varchar('storage_path', { length: 500 }).notNull(),

  // Only image/jpeg and image/png are accepted (task 88)
  mimeType: varchar('mime_type', { length: 50 }).notNull(),

  // File size in bytes; max 5 MB (5_242_880) enforced at application layer (task 88)
  sizeBytes: integer('size_bytes').notNull(),

  // SHA-256 hex digest; checked against image_hashes blocklist on upload (task 89)
  sha256: varchar('sha256', { length: 64 }).notNull(),

  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type ReviewImage = typeof reviewImages.$inferSelect;
export type NewReviewImage = typeof reviewImages.$inferInsert;
