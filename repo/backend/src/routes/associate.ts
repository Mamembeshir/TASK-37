import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, notInArray } from 'drizzle-orm';
import { z, paginationQuery } from '../lib/zod';
import { afterSalesTickets } from '../db/schema/after-sales-tickets';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Statuses that end the ticket lifecycle — excluded from the active queue. */
const TERMINAL_STATUSES = ['resolved', 'cancelled'] as const;

/** Valid department values for the optional filter query param. */
const DEPARTMENTS = ['front_desk', 'fulfillment', 'accounting'] as const;

// ── Response schema ───────────────────────────────────────────────────────────

const ticketQueueItem = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  department: z.string(),
  assignedTo: z.string().uuid().nullable(),
  receiptReference: z.string().nullable(),
  windowDays: z.number().int(),
  outcome: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ticketQueueResponse = z.object({
  data: z.array(ticketQueueItem),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function associateRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /associate/tickets
   *
   * Staff queue of all active (non-terminal) tickets, optionally filtered by
   * department. Paginated. Associates use this to see what needs attention.
   *
   * Task 110. Auth: associate+.
   *
   * Query params:
   *   - department?: front_desk | fulfillment | accounting — filter by dept
   *   - limit?: number (default 20)
   *   - offset?: number (default 0)
   */
  app.get(
    '/tickets',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        querystring: paginationQuery.extend({
          department: z.enum(DEPARTMENTS).optional(),
        }),
        response: { 200: ticketQueueResponse },
      },
    },
    async (req, reply) => {
      const { limit, offset, department } = req.query;

      // Build the WHERE clause: exclude terminal statuses, optionally filter dept
      const conditions = [notInArray(afterSalesTickets.status, [...TERMINAL_STATUSES])];
      if (department) {
        conditions.push(eq(afterSalesTickets.department, department));
      }

      const where = and(...conditions);

      // Total count for pagination
      const [{ totalCount }] = await app.db
        .select({ totalCount: count() })
        .from(afterSalesTickets)
        .where(where);

      // Fetch page, newest first
      const rows = await app.db
        .select()
        .from(afterSalesTickets)
        .where(where)
        .orderBy(desc(afterSalesTickets.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows.map((t) => ({
          id: t.id,
          orderId: t.orderId,
          customerId: t.customerId,
          type: t.type,
          status: t.status,
          department: t.department,
          assignedTo: t.assignedTo ?? null,
          receiptReference: t.receiptReference ?? null,
          windowDays: t.windowDays,
          outcome: t.outcome ?? null,
          resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
        total: totalCount ?? 0,
        limit,
        offset,
      });
    },
  );
}

export default associateRoutes;
