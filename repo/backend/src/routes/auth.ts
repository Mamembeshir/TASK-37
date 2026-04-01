import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomBytes } from 'crypto';
import { hashToken } from '../lib/session';
import { eq, sql, and, gt } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { z, passwordSchema } from '../lib/zod';
import { users } from '../db/schema/users';
import { sessions } from '../db/schema/sessions';
import { auditLogs } from '../db/schema/audit-logs';
import { toUserView } from '../lib/mask';
import { sendError } from '../lib/reply';

// 8-hour session TTL — covers a full retail shift
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;


async function authRoutes(fastify: FastifyInstance) {
  // Re-bind with ZodTypeProvider so route body schemas are typed correctly
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /auth/login
   * Body: { username, password }
   * Returns: { token, expiresAt, user: { id, username, role } }
   */
  app.post('/login', {
    schema: {
      body: z.object({
        username: z.string().min(1, 'Username is required'),
        password: passwordSchema,
      }),
    },
  }, async (req, reply) => {
    const { username, password } = req.body;

    const [user] = await app.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    // Use a constant-time-safe response — never reveal whether username or
    // password was wrong to avoid user enumeration.
    if (!user) {
      return sendError(reply, 401, 'Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await app.db.insert(auditLogs).values({
        actorId: user.id,
        action: 'auth.login_rejected_locked',
        entityType: 'user',
        entityId: user.id,
        after: {
          lockedUntil: user.lockedUntil.toISOString(),
          failedAttempts: user.failedAttempts,
        },
      });

      return sendError(reply, 423, 'Account temporarily locked due to too many failed attempts');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      // Increment failedAttempts; lock account for 15 min on 5th failure (Q8).
      const LOCKOUT_THRESHOLD = 5;
      const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

      const newCount = user.failedAttempts + 1;
      const willLock = newCount >= LOCKOUT_THRESHOLD;
      const lockedUntil = willLock
        ? new Date(Date.now() + LOCKOUT_DURATION_MS)
        : null;

      await app.db
        .update(users)
        .set({
          failedAttempts: newCount,
          // Only set lockedUntil on the 5th failure; leave value untouched on attempts 1–4.
          ...(willLock ? { lockedUntil } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, user.id));

      await app.db.insert(auditLogs).values({
        actorId: user.id,
        action: willLock ? 'auth.account_locked' : 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        before: { failedAttempts: user.failedAttempts },
        after: {
          failedAttempts: newCount,
          ...(willLock ? { lockedUntil: lockedUntil!.toISOString() } : {}),
        },
      });

      return sendError(reply, 401, 'Invalid credentials');
    }

    // Clear failed-attempt counter on successful login (Q8).
    // Skip when there's nothing to reset to avoid an unnecessary UPDATE on every clean login.
    if (user.failedAttempts > 0 || user.lockedUntil !== null) {
      await app.db
        .update(users)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: sql`now()` })
        .where(eq(users.id, user.id));

      await app.db.insert(auditLogs).values({
        actorId: user.id,
        action: 'auth.counter_reset',
        entityType: 'user',
        entityId: user.id,
        before: {
          failedAttempts: user.failedAttempts,
          lockedUntil: user.lockedUntil?.toISOString() ?? null,
        },
        after: { failedAttempts: 0, lockedUntil: null },
      });
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await app.db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    await app.db.insert(auditLogs).values({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      after: { username: user.username, role: user.role },
    });

    return reply.status(200).send({
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  });

  /**
   * POST /auth/logout
   * Header: Authorization: Bearer <token>
   * Deletes the session row — token is immediately invalid for all subsequent
   * requests.  Returns 401 if the token is missing, malformed, or already
   * invalidated (idempotent from the client's perspective: just redirect to
   * login on any non-200).
   */
  app.post('/logout', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(reply, 401, 'Missing or invalid authorization header');
    }

    const rawToken = authHeader.slice(7).trim();
    const tokenHash = hashToken(rawToken);

    const [deleted] = await app.db
      .delete(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .returning();

    if (!deleted) {
      return sendError(reply, 401, 'Invalid or already invalidated token');
    }

    await app.db.insert(auditLogs).values({
      actorId: deleted.userId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: deleted.userId,
      after: { sessionId: deleted.id },
    });

    return reply.status(200).send({ ok: true });
  });

  /**
   * GET /auth/me
   * Header: Authorization: Bearer <token>
   * Returns the current user's profile.  Phone is masked for staff viewers
   * (associate / supervisor / manager / admin) so they cannot read a customer's
   * raw phone number even for their own session.
   */
  app.get('/me', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(reply, 401, 'Missing or invalid authorization header');
    }

    const rawToken = authHeader.slice(7).trim();
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const [row] = await app.db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        phone: users.phone,
        createdAt: users.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      return sendError(reply, 401, 'Invalid or expired token');
    }

    return reply.status(200).send(toUserView(row, row.role));
  });
}

export default authRoutes;
