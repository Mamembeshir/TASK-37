import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, gte, lte, ne } from 'drizzle-orm';
import { z, paginationQuery, uuidParam } from '../../lib/zod';
import { formatCampaignLabel } from '../../lib/campaign-label';
import { campaigns } from '../../db/schema/campaigns';
import { sendError } from '../../lib/reply';

// ── Shared body schema ────────────────────────────────────────────────────────

/**
 * YYYY-MM-DD date string — matches the PostgreSQL `date` column type.
 * Used by POST (create) and PUT (update).
 */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

/**
 * Valid strategy values mirror the recommendation_strategy PG enum.
 * Declared here so the same list is used for body validation and DB insert.
 */
const strategyEnum = z.enum([
  'popularity',
  'price_asc',
  'price_desc',
  'newest',
  'manual',
]);

export const campaignBodySchema = z
  .object({
    /** Store this campaign applies to — must match campaigns.store_id exactly. */
    storeId: z.string().min(1).max(100),
    /** A/B label shown in the UI, e.g. 'A', 'B', 'Control'. */
    variant: z.string().min(1).max(50),
    strategy: strategyEnum,
    startDate: dateString,
    endDate: dateString,
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be on or after startDate',
      });
    }
  });

// ── Query schema ──────────────────────────────────────────────────────────────

const listCampaignsQuery = paginationQuery.extend({
  /**
   * Filter by store — optional; when omitted returns campaigns for all stores.
   * Matches campaigns.store_id exactly.
   */
  storeId: z.string().min(1).max(100).optional(),

  /**
   * Filter by activation state.
   * true  = only rows with is_active = true
   * false = only deactivated rows
   * omit  = return all rows regardless of state
   */
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ── Response schema ───────────────────────────────────────────────────────────

const campaignItem = z.object({
  id: z.string().uuid(),
  storeId: z.string(),
  variant: z.string(),
  strategy: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isActive: z.boolean(),
  /**
   * true when isActive = true AND today falls within [startDate, endDate].
   * Computed server-side so the frontend can render the "Test A active for …"
   * banner without additional requests (SPEC Q5).
   */
  isCurrentlyActive: z.boolean(),
  /** Pre-formatted label for direct UI display, e.g. "Test A active for 03/25/2026–04/08/2026". */
  displayLabel: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listCampaignsResponse = z.object({
  data: z.array(campaignItem),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function adminCampaignRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Overlap helper ───────────────────────────────────────────────────────────

  /**
   * Returns true when an active campaign for the same store already covers
   * any part of [startDate, endDate].
   *
   * Two date ranges overlap when:  A.start <= B.end  AND  A.end >= B.start
   *
   * excludeId — pass the campaign's own id when checking on PUT so the row
   *             being updated is not counted against itself.
   *
   * SPEC Q5: "only one active test per store per date range."
   */
  async function hasOverlap(
    storeId: string,
    startDate: string,
    endDate: string,
    excludeId?: string,
  ): Promise<boolean> {
    const conditions = [
      eq(campaigns.storeId, storeId),
      eq(campaigns.isActive, true),
      lte(campaigns.startDate, endDate),   // existing.startDate <= new.endDate
      gte(campaigns.endDate, startDate),   // existing.endDate   >= new.startDate
    ];
    if (excludeId) conditions.push(ne(campaigns.id, excludeId));

    const [row] = await app.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(...conditions))
      .limit(1);

    return row !== undefined;
  }

  /**
   * GET /admin/campaigns
   *
   * List all campaigns with active A/B test info.  Admin only.
   *
   * Each campaign row includes `isCurrentlyActive` — a server-computed flag
   * that is true when the campaign's isActive flag is set AND today's date
   * falls within [startDate, endDate].  This supports the spec requirement
   * (Q5) that the UI can display: "Test A active for 03/25/2026–04/08/2026."
   *
   * Query params:
   *   storeId  — optional; filter to a specific store
   *   isActive — optional; 'true' | 'false' to filter by activation flag
   *   limit    — 1–100, default 20
   *   offset   — default 0
   *
   * Results are sorted by startDate DESC, then createdAt DESC.
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        querystring: listCampaignsQuery,
        response: { 200: listCampaignsResponse },
      },
    },
    async (req, reply) => {
      const { storeId, isActive, limit, offset } = req.query;

      // Build WHERE conditions dynamically
      const conditions = [];
      if (storeId !== undefined) conditions.push(eq(campaigns.storeId, storeId));
      if (isActive !== undefined) conditions.push(eq(campaigns.isActive, isActive));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(campaigns)
        .where(where);

      const rows = await app.db
        .select()
        .from(campaigns)
        .where(where)
        .orderBy(desc(campaigns.startDate), desc(campaigns.createdAt))
        .limit(limit)
        .offset(offset);

      // Today as YYYY-MM-DD — same format as the PG `date` columns
      const today = new Date().toISOString().split('T')[0];

      return reply.status(200).send({
        data: rows.map((r) => ({
          id: r.id,
          storeId: r.storeId,
          variant: r.variant,
          strategy: r.strategy,
          startDate: r.startDate,
          endDate: r.endDate,
          isActive: r.isActive,
          // Active today = flag set AND today within [startDate, endDate]
          isCurrentlyActive:
            r.isActive && r.startDate <= today && r.endDate >= today,
          displayLabel: formatCampaignLabel(r.variant, r.startDate, r.endDate),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    },
  );
  /**
   * POST /admin/campaigns
   *
   * Create a new A/B test campaign variant.  Admin only.
   *
   * Body:
   *   storeId   — required; store this campaign applies to
   *   variant   — required; label e.g. 'A', 'B', 'Control'
   *   strategy  — required; one of popularity | price_asc | price_desc | newest | manual
   *   startDate — required; YYYY-MM-DD; must be ≤ endDate
   *   endDate   — required; YYYY-MM-DD; must be ≥ startDate
   *
   * Newly created campaigns default to isActive = true.
   * Returns 409 if an active campaign for the same store already overlaps the
   * requested date range (SPEC Q5).  createdBy is set from the session user's id.
   *
   * Returns 201 with the created campaign.
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        body: campaignBodySchema,
        response: { 201: campaignItem },
      },
    },
    async (req, reply) => {
      const { storeId, variant, strategy, startDate, endDate } = req.body;

      // Reject if an active campaign for this store already overlaps the range.
      if (await hasOverlap(storeId, startDate, endDate)) {
        return sendError(reply, 409, 'An active campaign for this store already overlaps the requested date range');
      }

      const [created] = await app.db
        .insert(campaigns)
        .values({
          storeId,
          variant,
          strategy,
          startDate,
          endDate,
          isActive: true,
          createdBy: req.user!.id,
        })
        .returning();

      const today = new Date().toISOString().split('T')[0];

      return reply.status(201).send({
        id: created.id,
        storeId: created.storeId,
        variant: created.variant,
        strategy: created.strategy,
        startDate: created.startDate,
        endDate: created.endDate,
        isActive: created.isActive,
        isCurrentlyActive:
          created.isActive &&
          created.startDate <= today &&
          created.endDate >= today,
        displayLabel: formatCampaignLabel(created.variant, created.startDate, created.endDate),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  /**
   * PUT /admin/campaigns/:id
   *
   * Full replacement update of a campaign's mutable fields.  Admin only.
   *
   * Body fields (all required):
   *   storeId   — store this campaign applies to
   *   variant   — label e.g. 'A', 'B', 'Control'
   *   strategy  — one of popularity | price_asc | price_desc | newest | manual
   *   startDate — YYYY-MM-DD; must be ≤ endDate
   *   endDate   — YYYY-MM-DD; must be ≥ startDate
   *
   * isActive is intentionally excluded — deactivation is handled by
   * DELETE /admin/campaigns/:id.
   * createdBy is immutable and never updated.
   *
   * Returns 404 for unknown campaign ids.
   * Returns 409 if the new date range overlaps another active campaign for
   * the same store (SPEC Q5).  The campaign being updated is excluded from
   * the overlap check so shifting its own dates never produces a false 409.
   * Returns 200 with the updated campaign.
   */
  app.put(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        body: campaignBodySchema,
        response: { 200: campaignItem },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { storeId, variant, strategy, startDate, endDate } = req.body;

      // Verify the campaign exists
      const [existing] = await app.db
        .select({ id: campaigns.id, isActive: campaigns.isActive })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .limit(1);

      if (!existing) {
        return sendError(reply, 404, 'Campaign not found');
      }

      // Overlap check — exclude this campaign's own id so shifting its
      // dates doesn't falsely conflict with itself.
      if (await hasOverlap(storeId, startDate, endDate, id)) {
        return sendError(reply, 409, 'An active campaign for this store already overlaps the requested date range');
      }

      // Apply the update
      const [updated] = await app.db
        .update(campaigns)
        .set({
          storeId,
          variant,
          strategy,
          startDate,
          endDate,
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, id))
        .returning();

      const today = new Date().toISOString().split('T')[0];

      return reply.status(200).send({
        id: updated.id,
        storeId: updated.storeId,
        variant: updated.variant,
        strategy: updated.strategy,
        startDate: updated.startDate,
        endDate: updated.endDate,
        isActive: updated.isActive,
        isCurrentlyActive:
          updated.isActive &&
          updated.startDate <= today &&
          updated.endDate >= today,
        displayLabel: formatCampaignLabel(updated.variant, updated.startDate, updated.endDate),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    },
  );

  /**
   * DELETE /admin/campaigns/:id
   *
   * Deactivate a campaign by setting isActive = false.  Admin only.
   * The row is never physically removed so historical reports that reference
   * this campaign id remain intact.
   *
   * Idempotent: deleting an already-deactivated campaign returns 404
   * (consistent with GET — once inactive it is treated as non-existent
   * from the operator's perspective, matching the product soft-delete pattern).
   *
   * Returns 200 { ok: true } on success.
   * Returns 404 for unknown ids or already-deactivated campaigns.
   */
  app.delete(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      // UPDATE only if currently active; RETURNING lets us detect the 404 case
      // without a separate SELECT round-trip.
      const [deactivated] = await app.db
        .update(campaigns)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(and(eq(campaigns.id, id), eq(campaigns.isActive, true)))
        .returning({ id: campaigns.id });

      if (!deactivated) {
        return sendError(reply, 404, 'Campaign not found');
      }

      return reply.status(200).send({ ok: true });
    },
  );
}

export default adminCampaignRoutes;
