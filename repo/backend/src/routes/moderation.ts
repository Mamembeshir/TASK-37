import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, eq, gte } from 'drizzle-orm';
import { z, uuidParam } from '../lib/zod';
import { moderationFlags, moderationAppeals } from '../db/schema/moderation';
import { reviews, reviewImages } from '../db/schema/reviews';
import { imageHashes } from '../db/schema/image-hashes';
import { auditLogs } from '../db/schema/audit-logs';
import { sendError } from '../lib/reply';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Anti-fraud throttle: max 5 user reports per calendar day (Q6 confirmed). */
const MAX_REPORTS_PER_DAY = 5;

// ── Response schemas ──────────────────────────────────────────────────────────

const flagOut = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  source: z.string(),
  reason: z.string(),
  status: z.string(),
  reportedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const appealOut = z.object({
  id: z.string().uuid(),
  flagId: z.string().uuid(),
  submittedBy: z.string().uuid(),
  reason: z.string(),
  status: z.string(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  flag: flagOut,
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function moderationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /moderation/flags/:id/report
   *
   * Customer reports a piece of content (review or review_image) as inappropriate.
   * `:id` is the UUID of the entity being reported.
   *
   * Task 98:
   *   - source = 'user_report', reportedBy = req.user.id
   *   - Anti-fraud throttle: max 5 user_report flags per user per calendar day (Q6).
   *   - Duplicate check: reject if the same user has already reported the same entity today.
   *
   * Auth: any authenticated user.
   */
  app.post(
    '/flags/:id/report',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        body: z.object({
          entityType: z.enum(['review', 'review_image']),
          reason: z.string().min(1, 'reason is required').max(1000),
        }),
        response: { 201: flagOut },
      },
    },
    async (req, reply) => {
      const reporterId = req.user!.id;
      const { id: entityId } = req.params;
      const { entityType, reason } = req.body;

      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(moderationFlags)
        .where(
          and(
            eq(moderationFlags.reportedBy, reporterId),
            eq(moderationFlags.source, 'user_report'),
            gte(moderationFlags.createdAt, startOfToday),
          ),
        );

      if (total >= MAX_REPORTS_PER_DAY) {
        return sendError(reply, 429, `Report limit reached: maximum ${MAX_REPORTS_PER_DAY} reports per day.`);
      }

      const [duplicate] = await app.db
        .select({ id: moderationFlags.id })
        .from(moderationFlags)
        .where(
          and(
            eq(moderationFlags.reportedBy, reporterId),
            eq(moderationFlags.entityId, entityId),
            eq(moderationFlags.source, 'user_report'),
            gte(moderationFlags.createdAt, startOfToday),
          ),
        )
        .limit(1);

      if (duplicate) {
        return sendError(reply, 409, 'You have already reported this content today.');
      }

      const [flag] = await app.db
        .insert(moderationFlags)
        .values({ entityType, entityId, source: 'user_report', reason, reportedBy: reporterId })
        .returning();

      return reply.status(201).send({
        id: flag.id,
        entityType: flag.entityType,
        entityId: flag.entityId,
        source: flag.source,
        reason: flag.reason,
        status: flag.status,
        reportedBy: flag.reportedBy ?? null,
        createdAt: flag.createdAt.toISOString(),
      });
    },
  );

  /**
   * GET /moderation/appeals
   *
   * Staff view of the pending appeals queue.
   * Returns moderation_appeals with status='pending', joined with their flag.
   *
   * Task 99. Auth: associate or supervisor.
   */
  app.get(
    '/appeals',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        response: { 200: z.array(appealOut) },
      },
    },
    async (_req, reply) => {
      // Load pending appeals + their flags in two queries to keep it readable
      const appeals = await app.db
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.status, 'pending'));

      if (appeals.length === 0) {
        return reply.send([]);
      }

      // Load the flag for each appeal
      const result = await Promise.all(
        appeals.map(async (appeal) => {
          const [flag] = await app.db
            .select()
            .from(moderationFlags)
            .where(eq(moderationFlags.id, appeal.flagId))
            .limit(1);

          return {
            id: appeal.id,
            flagId: appeal.flagId,
            submittedBy: appeal.submittedBy,
            reason: appeal.reason,
            status: appeal.status,
            reviewedBy: appeal.reviewedBy ?? null,
            reviewedAt: appeal.reviewedAt ? appeal.reviewedAt.toISOString() : null,
            createdAt: appeal.createdAt.toISOString(),
            flag: {
              id: flag.id,
              entityType: flag.entityType,
              entityId: flag.entityId,
              source: flag.source,
              reason: flag.reason,
              status: flag.status,
              reportedBy: flag.reportedBy ?? null,
              createdAt: flag.createdAt.toISOString(),
            },
          };
        }),
      );

      return reply.send(result);
    },
  );

  /**
   * PUT /moderation/appeals/:id/resolve
   *
   * Staff approves or rejects a pending appeal.
   *
   * Task 100:
   *   approved → appeal.status='approved', flag.status='resolved_approved'.
   *     If flag entity is a review: review.moderationStatus → 'approved' (content restored).
   *   rejected → appeal.status='rejected', flag.status='resolved_rejected'.
   *     If flag entity is a review_image: insert sha256 into image_hashes to prevent
   *     re-upload (completes task 96 — requires human actor, which is the resolving staff).
   *
   * Writes an immutable audit log entry.
   * Auth: associate or supervisor.
   */
  app.put(
    '/appeals/:id/resolve',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        body: z.object({
          decision: z.enum(['approved', 'rejected']),
        }),
        response: { 200: appealOut },
      },
    },
    async (req, reply) => {
      const staffId = req.user!.id;
      const { id: appealId } = req.params;
      const { decision } = req.body;

      const [appeal] = await app.db
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.id, appealId))
        .limit(1);

      if (!appeal) {
        return sendError(reply, 404, 'Appeal not found.');
      }
      if (appeal.status !== 'pending') {
        return sendError(reply, 409, `Appeal has already been resolved (status: '${appeal.status}').`);
      }

      const [flag] = await app.db
        .select()
        .from(moderationFlags)
        .where(eq(moderationFlags.id, appeal.flagId))
        .limit(1);

      if (!flag) {
        return sendError(reply, 404, 'Linked flag not found.');
      }

      const now = new Date();
      const newAppealStatus = decision === 'approved' ? 'approved' : 'rejected';
      const newFlagStatus = decision === 'approved' ? 'resolved_approved' : 'resolved_rejected';

      await app.db.transaction(async (tx) => {
        await tx
          .update(moderationAppeals)
          .set({ status: newAppealStatus, reviewedBy: staffId, reviewedAt: now })
          .where(eq(moderationAppeals.id, appealId));

        await tx
          .update(moderationFlags)
          .set({ status: newFlagStatus, resolvedBy: staffId, resolvedAt: now })
          .where(eq(moderationFlags.id, flag.id));

        if (decision === 'approved' && flag.entityType === 'review') {
          // Restore content: mark review as approved
          await tx
            .update(reviews)
            .set({ moderationStatus: 'approved' })
            .where(eq(reviews.id, flag.entityId));
        }

        if (decision === 'rejected' && flag.entityType === 'review_image') {
          // Blocklist the image SHA-256 (human actor required to complete the review cycle).
          const [img] = await tx
            .select({ sha256: reviewImages.sha256 })
            .from(reviewImages)
            .where(eq(reviewImages.id, flag.entityId))
            .limit(1);

          if (img) {
            // Upsert: ignore duplicate sha256 (may already be in blocklist)
            await tx
              .insert(imageHashes)
              .values({ sha256: img.sha256, flaggedBy: staffId })
              .onConflictDoNothing();
          }
        }

        // 5. Audit log (task 100)
        await tx.insert(auditLogs).values({
          actorId: staffId,
          action: 'moderation.appeal_resolved',
          entityType: 'moderation_appeal',
          entityId: appealId,
          before: { appealStatus: 'pending', flagStatus: flag.status },
          after: {
            appealStatus: newAppealStatus,
            flagStatus: newFlagStatus,
            decision,
            flagEntityType: flag.entityType,
            flagEntityId: flag.entityId,
          },
        });
      });

      // Return updated appeal with flag
      const updatedAppeal = {
        id: appeal.id,
        flagId: appeal.flagId,
        submittedBy: appeal.submittedBy,
        reason: appeal.reason,
        status: newAppealStatus,
        reviewedBy: staffId,
        reviewedAt: now.toISOString(),
        createdAt: appeal.createdAt.toISOString(),
        flag: {
          id: flag.id,
          entityType: flag.entityType,
          entityId: flag.entityId,
          source: flag.source,
          reason: flag.reason,
          status: newFlagStatus,
          reportedBy: flag.reportedBy ?? null,
          createdAt: flag.createdAt.toISOString(),
        },
      };

      return reply.send(updatedAppeal);
    },
  );
}

export default moderationRoutes;
