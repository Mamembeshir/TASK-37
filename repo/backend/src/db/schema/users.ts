import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', [
  'customer',
  'associate',
  'supervisor',
  'manager',
  'admin',
]);

// Customer loyalty tiers (task 138).
// Thresholds: standard 0–999 pts, silver 1000–4999, gold 5000–9999, top 10000+.
// Points are awarded at order pickup; tier is recomputed whenever points change.
// Top-tier customers bypass the $50 price-adjustment cap (task 139).
export const customerTierEnum = pgEnum('customer_tier', [
  'standard',
  'silver',
  'gold',
  'top',
]);

export type CustomerTier = 'standard' | 'silver' | 'gold' | 'top';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: roleEnum('role').notNull().default('customer'),
  // Phone stored AES-256-GCM encrypted at rest (task 41).
  // Column type is text (unbounded) because the encrypted format
  // iv_hex:authTag_hex:ciphertext_hex is ~88+ chars for a typical phone string.
  //
  // Write path: encryptNullable(rawPhone)  → store result
  // Read path:  decryptNullable(row.phone) → pass plaintext to toUserView()
  //
  // toUserView() always receives decrypted plaintext; it then applies
  // phoneForViewer() masking based on the viewer's role.
  phone: text('phone'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  // null = not locked; set to now()+15min on 5th consecutive failure (Q8)
  lockedUntil: timestamp('locked_until', { withTimezone: true }),

  // Loyalty points accumulated across all picked-up orders (task 140).
  // Incremented at pickup using the rules-engine multiplier for the customer's tier.
  points: integer('points').notNull().default(0),

  // Current loyalty tier, recomputed whenever points change (task 138).
  tier: customerTierEnum('tier').notNull().default('standard'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
