/**
 * Centralized audit log writer (task 142).
 *
 * Every state-changing endpoint must call writeAuditLog() (task 143) with:
 *   - actorId   — UUID of the acting user, or null for system events
 *   - action    — verb.noun string, e.g. 'order.created', 'ticket.resolved'
 *   - entityType — e.g. 'order', 'ticket', 'review', 'user'
 *   - entityId  — UUID of the specific entity
 *   - before    — state snapshot before the change (null for creation events)
 *   - after     — state snapshot after the change
 *   - nodeDurationMs — elapsed ms since the previous timeline node for ticket
 *                      workflow steps (checkin → triage → resolve), task 144
 *
 * The audit_logs table is immutable — UPDATE and DELETE are forbidden at the
 * DB level via privilege revocation (task 146) and a trigger (task 147).
 */

import { auditLogs } from './db/schema/audit-logs';
import type { FastifyInstance } from 'fastify';

type Db = FastifyInstance['db'];

export interface WriteAuditLogParams {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Duration in ms since the previous workflow node (task 144). */
  nodeDurationMs?: number | null;
}

/**
 * Insert one immutable audit log row.
 * Accepts either `db` (for out-of-transaction calls) or a Drizzle transaction
 * object `tx` — both satisfy the same interface.
 */
export async function writeAuditLog(
  db: Db,
  params: WriteAuditLogParams,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: params.actorId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    before: params.before ?? null,
    after: params.after ?? null,
    nodeDurationMs: params.nodeDurationMs ?? null,
  });
}
