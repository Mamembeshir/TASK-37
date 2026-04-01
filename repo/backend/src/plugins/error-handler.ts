import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'crypto';
import { auditLogs } from '../db/schema/audit-logs';

/**
 * Global error handler — returns clean JSON responses and writes every
 * unhandled error to audit_logs so the immutable trail captures failures.
 */
async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler(async (error, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    // Log at appropriate level
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    } else {
      request.log.warn({ err: error }, 'request error');
    }

    // Write to immutable audit log (best-effort — don't throw if DB is down)
    try {
      await app.db.insert(auditLogs).values({
        id: randomUUID(),
        // actorId comes from session decoration added in task 37; null for now
        actorId: (request as any).session?.userId ?? null,
        action: 'request.error',
        entityType: 'http_request',
        entityId: randomUUID(),
        after: {
          method: request.method,
          url: request.url,
          statusCode,
          message: statusCode >= 500 ? 'Internal Server Error' : error.message,
          errorCode: error.code,
        },
      });
    } catch (dbErr) {
      request.log.error({ err: dbErr }, 'failed to write error audit log');
    }

    return reply.status(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      ...(process.env.NODE_ENV !== 'production' && statusCode >= 500
        ? { detail: error.message }
        : {}),
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
