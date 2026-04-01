import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, eq, gte, lte } from 'drizzle-orm';
import { z, paginationQuery } from '../lib/zod';
import { products } from '../db/schema/products';
import { campaigns } from '../db/schema/campaigns';
import type { Campaign } from '../db/schema/campaigns';
import { buildStrategyOrder } from '../lib/ranking';
import { formatCampaignLabel } from '../lib/campaign-label';

/** Strategy used when no campaign is active for the store on today's date. */
const DEFAULT_STRATEGY: Campaign['strategy'] = 'newest';

// ── Query schema ──────────────────────────────────────────────────────────────

const recommendationsQuery = paginationQuery.extend({
  /**
   * Store identifier — must match campaigns.store_id.
   * Required: recommendations are per-store.
   */
  storeId: z.string().min(1).max(100),
});

// ── Response schemas ──────────────────────────────────────────────────────────

const campaignMeta = z.object({
  id: z.string().uuid(),
  variant: z.string(),
  strategy: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  /** Pre-formatted label for direct UI display, e.g. "Test A active for 03/25/2026–04/08/2026". */
  displayLabel: z.string(),
});

const recommendationsResponse = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
      brand: z.string().nullable(),
      price: z.string(),
      stockQty: z.number().int(),
      category: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  /** null when no campaign is active for the store on today's date. */
  campaign: campaignMeta.nullable(),
  /** The strategy that was actually applied (from campaign or default). */
  strategy: z.string(),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function recommendationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /recommendations
   *
   * Returns a ranked list of active products for the given store based on
   * the campaign that is active today (isActive=true, startDate≤today≤endDate).
   * Falls back to DEFAULT_STRATEGY ('newest') when no campaign is active.
   *
   * Public — no authentication required (kiosk catalog browsing per SPEC).
   *
   * Query params:
   *   storeId  — required; identifies which store's active campaign to look up
   *   limit    — 1-100, default 20
   *   offset   — default 0
   *
   * Response includes a `campaign` object (or null) so the frontend can render:
   *   "Test A active for 03/25/2026–04/08/2026"  (per SPEC, Q5 / task 58)
   *
   * Ranking strategies are expanded in task 52.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: recommendationsQuery,
        response: { 200: recommendationsResponse },
      },
    },
    async (req, reply) => {
      const { storeId, limit, offset } = req.query;

      // Today's date as YYYY-MM-DD string — matches the PG `date` column type.
      const today = new Date().toISOString().split('T')[0];

      // Find the single active campaign for this store on today's date.
      // Q5 confirms only one active campaign per store/date is allowed.
      const [campaign] = await app.db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.storeId, storeId),
            eq(campaigns.isActive, true),
            lte(campaigns.startDate, today),  // campaign started on or before today
            gte(campaigns.endDate, today),    // campaign ends on or after today
          ),
        )
        .limit(1);

      const strategy = campaign?.strategy ?? DEFAULT_STRATEGY;
      const orderBy = buildStrategyOrder(strategy);

      // Fetch only active (non-soft-deleted) products
      const where = eq(products.isActive, true);

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(products)
        .where(where);

      const rows = await app.db
        .select()
        .from(products)
        .where(where)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      return reply.status(200).send({
        data: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          brand: r.brand,
          price: r.price,
          stockQty: r.stockQty,
          category: r.category,
          createdAt: r.createdAt.toISOString(),
        })),
        campaign: campaign
          ? {
              id: campaign.id,
              variant: campaign.variant,
              strategy: campaign.strategy,
              startDate: campaign.startDate,
              endDate: campaign.endDate,
              displayLabel: formatCampaignLabel(campaign.variant, campaign.startDate, campaign.endDate),
            }
          : null,
        strategy,
        total,
        limit,
        offset,
      });
    },
  );
}

export default recommendationRoutes;
