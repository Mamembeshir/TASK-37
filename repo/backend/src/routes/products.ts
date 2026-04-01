import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, gte, lte, gt, count, asc, desc, sql } from 'drizzle-orm';
import { z, uuidParam } from '../lib/zod';
import { paginationQuery } from '../lib/zod';
import { products } from '../db/schema/products';
import { sendError } from '../lib/reply';

// ── Query schema ──────────────────────────────────────────────────────────────

/**
 * Allowed sort values and their Drizzle ORDER BY expressions.
 * Defined outside the schema so the map can be used in the handler.
 *
 *   price_asc    — cheapest first
 *   price_desc   — most expensive first
 *   name_asc     — A → Z  (default — stable, human-friendly)
 *   name_desc    — Z → A
 *   availability — highest stock_qty first (most available products first)
 */
const SORT_VALUES = ['price_asc', 'price_desc', 'name_asc', 'name_desc', 'availability'] as const;
type SortValue = (typeof SORT_VALUES)[number];

const SORT_MAP: Record<SortValue, ReturnType<typeof asc>> = {
  price_asc:    asc(products.price),
  price_desc:   desc(products.price),
  name_asc:     asc(products.name),
  name_desc:    desc(products.name),
  availability: desc(products.stockQty),
};

const productListQuery = paginationQuery.extend({
  /**
   * Full-text search across product name and description.
   * Uses PostgreSQL plainto_tsquery with the 'english' dictionary (stemming,
   * stop-word removal). Results are ranked by relevance when provided.
   */
  q: z.string().trim().min(1).max(200).optional(),

  /** Exact brand name filter (case-insensitive). */
  brand: z.string().trim().min(1).optional(),

  /**
   * Price range filters.  Values are coerced from query string to number.
   * Drizzle's numeric column accepts string values for SQL comparison.
   */
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),

  /**
   * When "true", only return products with stock_qty > 0.
   * URL query strings are always strings; transform to boolean explicitly.
   */
  available: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),

  /**
   * Sort order for the result set.
   * Defaults to name_asc — stable alphabetical order for consistent UX.
   */
  sortBy: z.enum(SORT_VALUES).default('name_asc'),
});

// ── Response schema ───────────────────────────────────────────────────────────

const productItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  brand: z.string().nullable(),
  /** Kept as string — numeric(10,2) in PG; never use float for money. */
  price: z.string(),
  stockQty: z.number().int(),
  category: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

const productListResponse = z.object({
  data: z.array(productItem),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function productRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /products
   *
   * List active products with optional filtering and offset pagination.
   * Public — no authentication required (kiosk catalog browsing per SPEC).
   *
   * Filters (all optional, combinable):
   *   brand      — exact name, case-insensitive
   *   minPrice   — inclusive lower price bound
   *   maxPrice   — inclusive upper price bound
   *   available  — "true" restricts to stock_qty > 0
   *
   * Pagination:
   *   limit   — 1-100, default 20
   *   offset  — default 0
   */
  app.get(
    '/',
    {
      schema: {
        querystring: productListQuery,
        response: { 200: productListResponse },
      },
    },
    async (req, reply) => {
      const { limit, offset, q, brand, minPrice, maxPrice, available, sortBy } = req.query;

      const conditions = [eq(products.isActive, true)];

      if (q !== undefined) {
        // Filter using the GIN-indexed generated tsvector column (migration 0007).
        // plainto_tsquery handles multi-word phrases without requiring special syntax.
        conditions.push(
          sql`products.search_vector @@ plainto_tsquery('english', ${q})`,
        );
      }

      if (brand !== undefined) {
        conditions.push(eq(products.brand, brand));
      }

      if (minPrice !== undefined) {
        conditions.push(gte(products.price, String(minPrice)));
      }

      if (maxPrice !== undefined) {
        conditions.push(lte(products.price, String(maxPrice)));
      }

      if (available === true) {
        conditions.push(gt(products.stockQty, 0));
      }

      const where = and(...conditions);

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(products)
        .where(where);

      // When a search query is present, rank by relevance first, then apply
      // the user's sort as a tiebreaker. Without a query, use sort only.
      const orderBy = q
        ? [
            sql`ts_rank(products.search_vector, plainto_tsquery('english', ${q})) DESC`,
            SORT_MAP[sortBy],
          ]
        : [SORT_MAP[sortBy]];

      const rows = await app.db
        .select()
        .from(products)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset);

      return reply.status(200).send({
        data: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          brand: r.brand,
          price: r.price,          // string — numeric(10,2) exact decimal
          stockQty: r.stockQty,
          category: r.category,
          isActive: r.isActive,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    },
  );

  /**
   * GET /products/:id
   *
   * Return a single product by UUID.
   * Public — no auth required (catalog browsing per SPEC).
   * Returns 404 for unknown IDs and for soft-deleted products (isActive = false).
   */
  app.get(
    '/:id',
    {
      schema: {
        params: uuidParam,
        response: { 200: productItem },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      const [product] = await app.db
        .select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.isActive, true)))
        .limit(1);

      if (!product) {
        return sendError(reply, 404, 'Product not found');
      }

      return reply.status(200).send({
        id: product.id,
        name: product.name,
        description: product.description,
        brand: product.brand,
        price: product.price,
        stockQty: product.stockQty,
        category: product.category,
        isActive: product.isActive,
        createdAt: product.createdAt.toISOString(),
      });
    },
  );
}

export default productRoutes;
