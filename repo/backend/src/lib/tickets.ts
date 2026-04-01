import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { afterSalesTickets } from '../db/schema/after-sales-tickets';
import { ticketEvents } from '../db/schema/ticket-events';
import { notifications } from '../db/schema/notifications';
import { encryptNullable } from './crypto';

type Db = FastifyInstance['db'];

/** Initial department routing by ticket type. */
export const DEPT_BY_TYPE = {
  return: 'fulfillment',
  refund: 'accounting',
  price_adjustment: 'front_desk',
} as const satisfies Record<string, 'fulfillment' | 'accounting' | 'front_desk'>;

/**
 * Append one immutable event to a ticket's timeline.
 * Computes nodeDurationMs = now − last event's createdAt (null if first event).
 * Encrypts the note field at rest (AES-256-GCM).
 * Must be called inside the same transaction as the accompanying ticket UPDATE.
 */
export async function appendTicketEvent(
  tx: Db,
  params: {
    ticketId: string;
    actorId: string;
    eventType: typeof ticketEvents.$inferInsert['eventType'];
    note?: string | null;
    fromDept?: string | null;
    toDept?: string | null;
  },
) {
  const [last] = await tx
    .select({ createdAt: ticketEvents.createdAt })
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, params.ticketId))
    .orderBy(desc(ticketEvents.createdAt))
    .limit(1);

  const nodeDurationMs = last ? Date.now() - last.createdAt.getTime() : null;

  const [event] = await tx
    .insert(ticketEvents)
    .values({
      ticketId: params.ticketId,
      actorId: params.actorId,
      eventType: params.eventType,
      note: encryptNullable(params.note ?? null),
      fromDept: (params.fromDept ?? null) as typeof ticketEvents.$inferInsert['fromDept'],
      toDept: (params.toDept ?? null) as typeof ticketEvents.$inferInsert['toDept'],
      nodeDurationMs,
    })
    .returning();

  return event;
}

/**
 * Insert an in-app notification for the ticket's customer when status changes.
 * In-app only — no email or SMS per SPEC.
 * Must be called inside the same transaction as the accompanying ticket UPDATE.
 */
export async function notifyTicketStatusChange(
  tx: Db,
  params: { customerId: string; ticketId: string; newStatus: string },
) {
  await tx.insert(notifications).values({
    customerId: params.customerId,
    message: `Your ticket status has been updated to '${params.newStatus}'.`,
    entityType: 'ticket',
    entityId: params.ticketId,
  });
}

/** Map a DB ticket row to the standard ticketOut response shape. */
export function toTicketOut(t: typeof afterSalesTickets.$inferSelect) {
  return {
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
  };
}
