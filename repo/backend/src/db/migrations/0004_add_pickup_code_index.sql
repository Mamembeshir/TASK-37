-- Task 70: add pickup_code_index column for deterministic uniqueness enforcement.
-- pickup_code stores the bcrypt hash (secure, non-deterministic).
-- pickup_code_index stores SHA-256(plain_code) as 64-char hex — deterministic,
-- queryable, and covered by a UNIQUE constraint so no two active orders can share
-- the same underlying 6-digit code.
ALTER TABLE "orders"
  ADD COLUMN "pickup_code_index" varchar(64),
  ADD CONSTRAINT "orders_pickup_code_index_unique" UNIQUE ("pickup_code_index");
