-- Task 52: Add sort_order column to products for manual ranking strategy.
-- NULLable integer; lower values appear first; NULL = unranked → NULLS LAST in queries.
ALTER TABLE "products" ADD COLUMN "sort_order" integer;
