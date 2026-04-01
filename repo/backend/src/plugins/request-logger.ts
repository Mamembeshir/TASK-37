import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'crypto';
import { auditLogs } from '../db/schema/audit-logs';

// Only log mutating methods — GET/HEAD are read-only and not audit-worthy at
// the HTTP layer (business-entity-level reads are handled in route handlers).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Request logger — writes one audit_log row for every mutating HTTP request
 * after the response is sent.  Entity-level logs (e.g. 'order.created') are
 * appended by the individual route handlers; this plugin captures the HTTP
 * envelope so failures are always traceable even if a route handler throws
 * before it can write its own entry.
 */
async function requestLoggerPlugin(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return;

    // Best-effort — never let audit logging crash the response
    try {
      await app.db.insert(auditLogs).values({
        id: randomUUID(),
        actorId: (request as any).session?.userId ?? null,
        action: `http.${request.method.toLowerCase()}`,
        entityType: 'http_request',
        entityId: randomUUID(),
        after: {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
        },
      });
    } catch (err) {
      request.log.error({ err }, 'failed to write request audit log');
    }
  });
}

export default fp(requestLoggerPlugin, { name: 'request-logger' });
