-- Task 138: Add loyalty points and tier to users table.
-- Tier thresholds: standard 0-999, silver 1000-4999, gold 5000-9999, top 10000+.
-- Top-tier customers bypass the $50 price-adjustment cap (task 139).
-- Points are awarded at order pickup with a tier-based multiplier (task 140).

DO $$ BEGIN
  CREATE TYPE "public"."customer_tier" AS ENUM('standard', 'silver', 'gold', 'top');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "points" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tier" "customer_tier" NOT NULL DEFAULT 'standard';
