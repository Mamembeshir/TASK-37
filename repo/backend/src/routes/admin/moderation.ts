import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z, paginationQuery, uuidParam } from '../../lib/zod';
import { reviews, reviewImages } from '../../db/schema/reviews';
import { moderationFlags } from '../../db/schema/moderation';
import { users } from '../../db/schema/users';
import { auditLogs } from '../../db/schema/audit-logs';
import { sendError } from '../../lib/reply';
import type { DB } from '../../db/index';

// ── Response schema ────────────────────────────────────────────────────────────

const moderationItemOut = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  body: z.string(),
  isFollowup: z.boolean(),
  moderationStatus: z.enum(['pending', 'approved', 'flagged']),
  flagReason: z.string().nullable(),
  submittedAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedByUsername: z.string().nullable(),
  resolvedNote: z.string().nullable(),
  imageCount: z.number().int(),
});

type ModerationFlag = typeof moderationFlags.$inferSelect;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Batch-load flag, image count, and resolver username data for a list of reviews. */
async function loadReviewMetadata(
  database: DB,
  reviewRows: (typeof reviews.$inferSelect)[],
) {
  const reviewIds = reviewRows.map((r) => r.id);

  const flagMap: Record<string, ModerationFlag> = {};
  const imageCounts: Record<string, number> = {};
  const resolverNames: Record<string, string> = {};

  if (reviewIds.length === 0) return { flagMap, imageCounts, resolverNames };

  // Image counts per review
  const imgRows = await database
    .select({ reviewId: reviewImages.reviewId, cnt: count() })
    .from(reviewImages)
    .where(inArray(reviewImages.reviewId, reviewIds))
    .groupBy(reviewImages.reviewId);

  for (const r of imgRows) imageCounts[r.reviewId] = r.cnt;

  // Most recent flag per review (entity_type = 'review')
  const flagRows = await database
    .select()
    .from(moderationFlags)
    .where(
      and(
        eq(moderationFlags.entityType, 'review'),
        inArray(moderationFlags.entityId, reviewIds),
      ),
    )
    .orderBy(desc(moderationFlags.createdAt));

  for (const f of flagRows) {
    if (!flagMap[f.entityId]) flagMap[f.entityId] = f;
  }

  // Resolver usernames
  const resolverIds = [
    ...new Set(
      Object.values(flagMap)
        .filter((f) => f.resolvedBy != null)
        .map((f) => f.resolvedBy!),
    ),
  ];

  if (resolverIds.length > 0) {
    const resolvers = await database
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, resolverIds));
    for (const u of resolvers) resolverNames[u.id] = u.username;
  }

  return { flagMap, imageCounts, resolverNames };
}

function toModerationItem(
  review: typeof reviews.$inferSelect,
  flag: ModerationFlag | undefined,
  resolverNames: Record<string, string>,
  imageCount: number,
): z.infer<typeof moderationItemOut> {
  return {
    id: review.id,
    orderId: review.orderId,
    customerId: review.customerId,
    body: review.body,
    isFollowup: review.isFollowup,
    moderationStatus: review.moderationStatus,
    flagReason: flag?.reason ?? null,
    submittedAt: review.submittedAt.toISOString(),
    resolvedAt: flag?.resolvedAt ? flag.resolvedAt.toISOString() : null,
    resolvedByUsername: flag?.resolvedBy ? (resolverNames[flag.resolvedBy] ?? null) : null,
    resolvedNote: null,
    imageCount,
  };
}

// ── Route plugin ──────────────────────────────────────────────────────────────

async function adminModerationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /admin/moderation
   *
   * Returns all reviews with flag metadata, ordered by submission date (newest first).
   * Auth: supervisor, manager, or admin.
   */
  app.get(
    '/',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('supervisor', 'manager', 'admin'),
      ],
      schema: {
        querystring: paginationQuery,
        response: { 200: z.array(moderationItemOut) },
      },
    },
    async (req, reply) => {
      const { limit, offset } = req.query;

      const rows = await app.db
        .select()
        .from(reviews)
        .orderBy(desc(reviews.submittedAt))
        .limit(limit)
        .offset(offset);

      const { flagMap, imageCounts, resolverNames } = await loadReviewMetadata(app.db, rows);

      return reply.send(
        rows.map((r) =>
          toModerationItem(r, flagMap[r.id], resolverNames, imageCounts[r.id] ?? 0),
        ),
      );
    },
  );

  /**
   * POST /admin/moderation/:id/approve
   *
   * Approve a review: sets moderationStatus = 'approved', resolves pending flags,
   * writes immutable audit log.
   * Auth: supervisor, manager, or admin.
   */
  app.post(
    '/:id/approve',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        body: z.object({ note: z.string().nullable().optional() }),
        response: { 200: moderationItemOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const note = req.body.note ?? null;
      const actorId = req.user!.id;
      const now = new Date();

      const [review] = await app.db
        .select()
        .from(reviews)
        .where(eq(reviews.id, id))
        .limit(1);
      if (!review) return sendError(reply, 404, 'Review not found.');

      await app.db.transaction(async (tx) => {
        await tx
          .update(reviews)
          .set({ moderationStatus: 'approved' })
          .where(eq(reviews.id, id));

        await tx
          .update(moderationFlags)
          .set({ status: 'resolved_approved', resolvedBy: actorId, resolvedAt: now })
          .where(
            and(
              eq(moderationFlags.entityType, 'review'),
              eq(moderationFlags.entityId, id),
              eq(moderationFlags.status, 'pending'),
            ),
          );

        await tx.insert(auditLogs).values({
          actorId,
          action: 'moderation.review_approved',
          entityType: 'review',
          entityId: id,
          before: { moderationStatus: review.moderationStatus },
          after: { moderationStatus: 'approved', note },
        });
      });

      const [updated] = await app.db
        .select()
        .from(reviews)
        .where(eq(reviews.id, id))
        .limit(1);

      const { flagMap, imageCounts, resolverNames } = await loadReviewMetadata(app.db, [updated]);
      return reply.send(
        toModerationItem(updated, flagMap[updated.id], resolverNames, imageCounts[updated.id] ?? 0),
      );
    },
  );

  /**
   * POST /admin/moderation/:id/reject
   *
   * Reject a review: sets moderationStatus = 'flagged' (content suppressed),
   * resolves pending flags as rejected, writes immutable audit log.
   * Auth: supervisor, manager, or admin.
   */
  app.post(
    '/:id/reject',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        body: z.object({ note: z.string().nullable().optional() }),
        response: { 200: moderationItemOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const note = req.body.note ?? null;
      const actorId = req.user!.id;
      const now = new Date();

      const [review] = await app.db
        .select()
        .from(reviews)
        .where(eq(reviews.id, id))
        .limit(1);
      if (!review) return sendError(reply, 404, 'Review not found.');

      await app.db.transaction(async (tx) => {
        await tx
          .update(reviews)
          .set({ moderationStatus: 'flagged' })
          .where(eq(reviews.id, id));

        await tx
          .update(moderationFlags)
          .set({ status: 'resolved_rejected', resolvedBy: actorId, resolvedAt: now })
          .where(
            and(
              eq(moderationFlags.entityType, 'review'),
              eq(moderationFlags.entityId, id),
              eq(moderationFlags.status, 'pending'),
            ),
          );

        await tx.insert(auditLogs).values({
          actorId,
          action: 'moderation.review_rejected',
          entityType: 'review',
          entityId: id,
          before: { moderationStatus: review.moderationStatus },
          after: { moderationStatus: 'flagged', note },
        });
      });

      const [updated] = await app.db
        .select()
        .from(reviews)
        .where(eq(reviews.id, id))
        .limit(1);

      const { flagMap, imageCounts, resolverNames } = await loadReviewMetadata(app.db, [updated]);
      return reply.send(
        toModerationItem(updated, flagMap[updated.id], resolverNames, imageCounts[updated.id] ?? 0),
      );
    },
  );
}

export default adminModerationRoutes;
