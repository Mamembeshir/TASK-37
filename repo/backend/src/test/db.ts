/**
 * Test database helper.
 *
 * Provides:
 *   - testDb   — a Drizzle instance connected to the test database
 *   - runMigrations()  — apply all pending migrations (call once in beforeAll)
 *   - clearAllTables() — truncate every table in FK-safe order (call in beforeEach)
 *   - closeDb()        — close the postgres connection pool (call in afterAll)
 *
 * The test database URL is resolved from DATABASE_URL env (overridden to
 * retail_hub_test in vitest.config.ts).  Run `createdb retail_hub_test`
 * or use the helper below before running integration tests.
 *
 * Usage:
 *   import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db';
 *
 *   beforeAll(async () => { await runMigrations(); });
 *   beforeEach(async () => { await clearAllTables(); });
 *   afterAll(async () => { await closeDb(); });
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { resolve } from 'path';
import * as schema from '../db/schema/index.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:changeme@localhost:5432/retail_hub_test';

// A separate low-limit pool just for tests.
const client = postgres(DATABASE_URL, {
  max: 3,
  idle_timeout: 10,
  connect_timeout: 10,
  onnotice: () => {}, // suppress NOTICE messages during migrations
});

export const testDb = drizzle(client, { schema });

const MIGRATIONS_FOLDER = resolve(
  new URL('.', import.meta.url).pathname,
  '../db/migrations',
);

export async function runMigrations(): Promise<void> {
  await migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Truncate all tables in an order that respects foreign-key constraints.
 * Leaf tables (no FK dependents) first, then parents.
 */
export async function clearAllTables(): Promise<void> {
  await client`
    TRUNCATE TABLE
      ticket_events,
      moderation_appeals,
      moderation_flags,
      image_hashes,
      review_images,
      reviews,
      notifications,
      after_sales_tickets,
      order_items,
      pickup_group_items,
      pickup_groups,
      tender_splits,
      orders,
      cart_items,
      carts,
      audit_logs,
      sessions,
      banned_terms,
      rules_history,
      rules,
      campaigns,
      products,
      users
    RESTART IDENTITY CASCADE
  `;
}

export async function closeDb(): Promise<void> {
  await client.end();
}
