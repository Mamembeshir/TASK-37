import type { FastifyReply } from 'fastify';

/**
 * Send an error response. Use this everywhere instead of
 * `reply.status(code).send({ statusCode, error })` to avoid the TypeScript
 * error caused by the Zod type provider typing reply.send() against the
 * declared success schema only.
 */
export function sendError(reply: FastifyReply, statusCode: number, error: string): void {
  // Cast to any to bypass strict Zod type-provider inference on error paths.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (reply.status(statusCode) as any).send({ statusCode, error });
}
