import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { z, uuidParam } from '../lib/zod';
import { notifications } from '../db/schema/notifications';
import { sendError } from '../lib/reply';

// ── Response schema ───────────────────────────────────────────────────────────

const notificationOut = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  message: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  isRead: z.boolean(),
  createdAt: z.string(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function notificationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /notifications
   *
   * Customer retrieves their own unread notifications, newest first.
   * In-app only — no email or SMS.
   *
   * Auth: any authenticated user (returns own notifications only).
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: { 200: z.array(notificationOut) },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;

      const rows = await app.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.customerId, customerId),
            eq(notifications.isRead, false),
          ),
        )
        .orderBy(notifications.createdAt);

      return reply.send(
        rows.map((n) => ({
          id: n.id,
          customerId: n.customerId,
          message: n.message,
          entityType: n.entityType ?? null,
          entityId: n.entityId ?? null,
          isRead: n.isRead,
          createdAt: n.createdAt.toISOString(),
        })),
      );
    },
  );

  /**
   * PUT /notifications/:id/read
   *
   * Mark a single notification as read. Customer may only mark their own.
   *
   * Auth: any authenticated user.
   */
  app.put(
    '/:id/read',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        response: { 200: notificationOut },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { id } = req.params;

      const [existing] = await app.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .limit(1);

      if (!existing) {
        return sendError(reply, 404, 'Notification not found.');
      }

      // Customers may only update their own notifications
      if (existing.customerId !== customerId) {
        return sendError(reply, 403, 'Access denied.');
      }

      const [updated] = await app.db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, id))
        .returning();

      return reply.send({
        id: updated.id,
        customerId: updated.customerId,
        message: updated.message,
        entityType: updated.entityType ?? null,
        entityId: updated.entityId ?? null,
        isRead: updated.isRead,
        createdAt: updated.createdAt.toISOString(),
      });
    },
  );
}

export default notificationRoutes;
