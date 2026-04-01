import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { z, paginationQuery } from '../../lib/zod';
import { auditLogs } from '../../db/schema/audit-logs';

// ── Response schema ───────────────────────────────────────────────────────────

const auditLogOut = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  nodeDurationMs: z.number().int().nullable(),
  createdAt: z.string(),
});

const auditLogsListOut = z.object({
  data: z.array(auditLogOut),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function adminAuditLogsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /admin/audit-logs
   *
   * Paginated, filterable view of the immutable audit log.
   *
   * Task 145. Auth: admin or supervisor only.
   *
   * Query params:
   *   - entityType?: string     — filter by entity type (e.g. 'order', 'ticket')
   *   - actorId?: UUID          — filter by the acting user
   *   - dateFrom?: ISO string   — include logs created at or after this timestamp
   *   - dateTo?:   ISO string   — include logs created at or before this timestamp
   *   - limit?: number (default 20, max 100)
   *   - offset?: number (default 0)
   *
   * Results are ordered newest-first.
   */
  app.get(
    '/',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('supervisor', 'manager', 'admin'),
      ],
      schema: {
        querystring: paginationQuery.extend({
          entityType: z.string().optional(),
          actorId: z.string().uuid().optional(),
          dateFrom: z.string().datetime({ offset: true }).optional(),
          dateTo: z.string().datetime({ offset: true }).optional(),
        }),
        response: { 200: auditLogsListOut },
      },
    },
    async (req, reply) => {
      const { limit, offset, entityType, actorId, dateFrom, dateTo } = req.query;

      // Build WHERE conditions
      const conditions = [];
      if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
      if (actorId)    conditions.push(eq(auditLogs.actorId, actorId));
      if (dateFrom)   conditions.push(gte(auditLogs.createdAt, new Date(dateFrom)));
      if (dateTo)     conditions.push(lte(auditLogs.createdAt, new Date(dateTo)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ totalCount }] = await app.db
        .select({ totalCount: count() })
        .from(auditLogs)
        .where(where);

      const rows = await app.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          actorId: r.actorId ?? null,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: r.before ?? null,
          after: r.after ?? null,
          nodeDurationMs: r.nodeDurationMs ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        total: totalCount ?? 0,
        limit,
        offset,
      });
    },
  );
}

export default adminAuditLogsRoutes;
