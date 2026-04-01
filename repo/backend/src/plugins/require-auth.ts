import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, gt } from 'drizzle-orm';
import { sessions } from '../db/schema/sessions';
import { users } from '../db/schema/users';
import { hashToken } from '../lib/session';
import type { Role } from '../lib/roles';
import type { db } from '../db/index';

/**
 * The authenticated user shape attached to every request that passes requireAuth.
 * Intentionally minimal — only what downstream handlers need for RBAC and audit logs.
 * Sensitive fields (passwordHash, failedAttempts, lockedUntil) are never exposed.
 */
export type AuthUser = {
  id: string;
  username: string;
  role: Role;
};

// Extend FastifyRequest and FastifyInstance with the types added by this plugin.
declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Populated by requireAuth preHandler.
     * null on routes that do not use requireAuth (e.g. /auth/login, /health).
     */
    user: AuthUser | null;
  }

  interface FastifyInstance {
    /**
     * Fastify preHandler that validates the Bearer token and populates req.user.
     * Add to any protected route:
     *   { preHandler: [fastify.requireAuth] }
     */
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

    /**
     * Factory that returns a preHandler enforcing role membership.
     * Must follow requireAuth in the preHandler chain.
     *
     * Exact set check — list every role that is permitted:
     *   { preHandler: [fastify.requireAuth, fastify.requireRole('manager', 'admin')] }
     *
     * All staff (everyone except customers):
     *   { preHandler: [fastify.requireAuth, fastify.requireRole('associate','supervisor','manager','admin')] }
     */
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

    // Re-declared so this file compiles independently of index.ts augmentation.
    db: typeof db;
  }
}

async function requireAuthPlugin(fastify: FastifyInstance) {
  // Default value must be provided for decorateRequest so Fastify
  // pre-allocates the property on every request object.
  fastify.decorateRequest('user', null);

  fastify.decorate(
    'requireAuth',
    async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Missing or invalid authorization header',
        });
      }

      const rawToken = authHeader.slice(7).trim();
      const tokenHash = hashToken(rawToken);
      const now = new Date();

      // Single query: join sessions → users, verify token hash and expiry.
      const [row] = await fastify.db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
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
        return reply.status(401).send({
          statusCode: 401,
          error: 'Invalid or expired token',
        });
      }

      req.user = row;
    },
  );

  fastify.decorate(
    'requireRole',
    function requireRole(...roles: Role[]) {
      return async function checkRole(req: FastifyRequest, reply: FastifyReply): Promise<void> {
        // requireAuth must run before requireRole in the preHandler chain.
        // If req.user is null here, the caller forgot to include requireAuth.
        if (!req.user) {
          return reply.status(401).send({
            statusCode: 401,
            error: 'Authentication required',
          });
        }

        if (!roles.includes(req.user.role)) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Insufficient permissions',
          });
        }
      };
    },
  );
}

export default fp(requireAuthPlugin, { name: 'require-auth' });
