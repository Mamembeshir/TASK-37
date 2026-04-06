import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, gt, ilike, inArray, isNotNull, max, sql } from 'drizzle-orm';
import { z, paginationQuery, uuidParam } from '../../lib/zod';
import { users } from '../../db/schema/users';
import { sessions } from '../../db/schema/sessions';
import { auditLogs } from '../../db/schema/audit-logs';
import { decryptNullable } from '../../lib/crypto';
import { maskPhone } from '../../lib/mask';
import { sendError } from '../../lib/reply';

const ROLES = ['customer', 'associate', 'supervisor', 'manager', 'admin'] as const;

const adminUserOut = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(ROLES),
  phone: z.string().nullable(),
  isLocked: z.boolean(),
  failedAttempts: z.number().int(),
  lockedUntil: z.string().nullable(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});

const adminUserListOut = z.object({
  data: z.array(adminUserOut),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

function toAdminUser(
  u: typeof users.$inferSelect,
  lastLoginAt: Date | null | undefined,
  now: Date,
) {
  const locked = u.lockedUntil != null && u.lockedUntil > now;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    phone: maskPhone(decryptNullable(u.phone ?? null)),
    isLocked: locked,
    failedAttempts: u.failedAttempts,
    lockedUntil: u.lockedUntil ? u.lockedUntil.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
  };
}

async function adminUsersRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /admin/users
   *
   * Paginated list of all users, with optional filters.
   * Auth: admin only.
   *
   * Query params:
   *   q?        — case-insensitive username search
   *   role?     — filter by role
   *   isLocked? — 'true' to show only locked accounts
   *   limit?    — default 20, max 100
   *   offset?   — default 0
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        querystring: paginationQuery.extend({
          q: z.string().optional(),
          role: z.enum(ROLES).optional(),
          isLocked: z.string().optional(),
        }),
        response: { 200: adminUserListOut },
      },
    },
    async (req, reply) => {
      const { limit, offset, q, role, isLocked } = req.query;
      const now = new Date();

      const conditions = [];
      if (q) conditions.push(ilike(users.username, `%${q}%`));
      if (role) conditions.push(eq(users.role, role));
      if (isLocked === 'true') {
        conditions.push(isNotNull(users.lockedUntil));
        conditions.push(gt(users.lockedUntil, now));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [{ total }] = await app.db
        .select({ total: count() })
        .from(users)
        .where(where);

      const rows = await app.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      const userIds = rows.map((u) => u.id);
      const lastLogins: Record<string, Date> = {};
      if (userIds.length > 0) {
        const sessionRows = await app.db
          .select({ userId: sessions.userId, last: max(sessions.createdAt) })
          .from(sessions)
          .where(inArray(sessions.userId, userIds))
          .groupBy(sessions.userId);
        for (const s of sessionRows) {
          if (s.last) lastLogins[s.userId] = s.last;
        }
      }

      return reply.send({
        data: rows.map((u) => toAdminUser(u, lastLogins[u.id] ?? null, now)),
        total,
        limit,
        offset,
      });
    },
  );

  /**
   * PATCH /admin/users/:id/role
   *
   * Reassign a user's role. Writes an immutable audit log entry.
   * Auth: admin only.
   */
  app.patch(
    '/:id/role',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        body: z.object({ role: z.enum(ROLES) }),
        response: { 200: adminUserOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { role } = req.body;
      const actorId = req.user!.id;

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) return sendError(reply, 404, 'User not found.');
      if (user.role === role) return sendError(reply, 409, 'User already has that role.');

      const [updated] = await app.db
        .update(users)
        .set({ role, updatedAt: sql`now()` })
        .where(eq(users.id, id))
        .returning();

      await app.db.insert(auditLogs).values({
        actorId,
        action: 'admin.user_role_changed',
        entityType: 'user',
        entityId: id,
        before: { role: user.role },
        after: { role },
      });

      const [sessionRow] = await app.db
        .select({ last: max(sessions.createdAt) })
        .from(sessions)
        .where(eq(sessions.userId, id));

      const now = new Date();
      return reply.send(toAdminUser(updated, sessionRow?.last ?? null, now));
    },
  );

  /**
   * POST /admin/users/:id/reset-lockout
   *
   * Clears failed login attempts and removes the lockout timestamp.
   * Writes an immutable audit log entry.
   * Auth: admin only.
   */
  app.post(
    '/:id/reset-lockout',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        response: { 200: adminUserOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const actorId = req.user!.id;

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) return sendError(reply, 404, 'User not found.');

      const [updated] = await app.db
        .update(users)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: sql`now()` })
        .where(eq(users.id, id))
        .returning();

      await app.db.insert(auditLogs).values({
        actorId,
        action: 'admin.user_lockout_reset',
        entityType: 'user',
        entityId: id,
        before: {
          failedAttempts: user.failedAttempts,
          lockedUntil: user.lockedUntil?.toISOString() ?? null,
        },
        after: { failedAttempts: 0, lockedUntil: null },
      });

      const [sessionRow] = await app.db
        .select({ last: max(sessions.createdAt) })
        .from(sessions)
        .where(eq(sessions.userId, id));

      const now = new Date();
      return reply.send(toAdminUser(updated, sessionRow?.last ?? null, now));
    },
  );
}

export default adminUsersRoutes;
