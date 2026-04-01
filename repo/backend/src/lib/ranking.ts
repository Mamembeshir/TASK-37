/**
 * Ranking strategy implementations for the recommendation panel.
 *
 * SPEC: "a configurable recommendation panel lets an administrator toggle
 * ranking strategies and run A/B variants by store or date range."
 *
 * Five strategies (task 52):
 *
 *   price_asc   — cheapest first
 *   price_desc  — most expensive first
 *   newest      — most recently added to catalog first
 *   popularity  — most units sold (across non-cancelled order_items), DESC.
 *                 Uses a correlated subquery — acceptable for a bounded
 *                 offline retail catalog.
 *   manual      — admin-assigned sort_order (column added in this task).
 *                 Products with sort_order IS NULL appear last (NULLS LAST).
 *
 * Each function returns a Drizzle SQL expression suitable for .orderBy().
 */

import { asc, desc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { products } from '../db/schema/products';
import type { Campaign } from '../db/schema/campaigns';

/**
 * Returns the Drizzle ORDER BY expression for the given strategy.
 * Used by GET /recommendations (and any future ranked query).
 */
export function buildStrategyOrder(strategy: Campaign['strategy']): SQL {
  switch (strategy) {
    case 'price_asc':
      return asc(products.price) as unknown as SQL;

    case 'price_desc':
      return desc(products.price) as unknown as SQL;

    case 'newest':
      return desc(products.createdAt) as unknown as SQL;

    case 'popularity':
      /**
       * Rank by total units sold across all non-cancelled order_items.
       * cancelled_at IS NULL excludes items that were cancelled due to
       * out-of-stock or order cancellation.
       */
      return sql`(
        SELECT COALESCE(SUM(qty), 0)
        FROM order_items
        WHERE product_id = ${products.id}
          AND cancelled_at IS NULL
      ) DESC`;

    case 'manual':
      /**
       * sort_order is an admin-assigned integer (lower = earlier in list).
       * NULLS LAST puts products that have not been manually ranked at the
       * end of the list rather than the beginning.
       */
      return sql`${products.sortOrder} ASC NULLS LAST`;
  }
}
