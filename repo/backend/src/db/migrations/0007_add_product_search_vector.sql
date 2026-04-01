-- Task 45: Add PostgreSQL full-text search to products table.
-- A STORED generated tsvector column is built from name + description using
-- the 'english' dictionary (stemming, stop-word removal).
-- A GIN index makes @@ queries O(log n) instead of O(n).

ALTER TABLE products
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'english',
        coalesce(name, '') || ' ' || coalesce(description, '')
      )
    ) STORED;

CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
