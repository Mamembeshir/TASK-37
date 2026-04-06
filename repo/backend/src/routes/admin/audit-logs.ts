import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, getTableColumns, gte, ilike, inArray, lte } from 'drizzle-orm';
import { z, paginationQuery } from '../../lib/zod';
import { auditLogs } from '../../db/schema/audit-logs';
import { users } from '../../db/schema/users';

// ── Response schema ───────────────────────────────────────────────────────────

const auditLogOut = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorUsername: z.string().nullable(),
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
   *   - entityType?: string  — filter by entity type (e.g. 'order', 'ticket')
   *   - actor?: string       — filter by actor username (partial, case-insensitive)
   *   - from?: ISO string    — include logs created at or after this timestamp
   *   - to?:   ISO string    — include logs created at or before this timestamp
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
          actor: z.string().optional(),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
        }),
        response: { 200: auditLogsListOut },
      },
    },
    async (req, reply) => {
      const { limit, offset, entityType, actor, from, to } = req.query;

      // Build WHERE conditions
      const conditions = [];
      if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
      if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)));
      if (to)   conditions.push(lte(auditLogs.createdAt, new Date(to)));

      // Actor username filter: look up matching user IDs first
      if (actor) {
        const matchedUsers = await app.db
          .select({ id: users.id })
          .from(users)
          .where(ilike(users.username, `%${actor}%`));
        if (matchedUsers.length === 0) {
          return reply.send({ data: [], total: 0, limit, offset });
        }
        conditions.push(inArray(auditLogs.actorId, matchedUsers.map((u) => u.id)));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ totalCount }] = await app.db
        .select({ totalCount: count() })
        .from(auditLogs)
        .where(where);

      const rows = await app.db
        .select({
          ...getTableColumns(auditLogs),
          actorUsername: users.username,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorId, users.id))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          actorId: r.actorId ?? null,
          actorUsername: r.actorUsername ?? null,
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
