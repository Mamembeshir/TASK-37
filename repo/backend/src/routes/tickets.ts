import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { z, uuidParam, paginationQuery } from '../lib/zod';
import { afterSalesTickets } from '../db/schema/after-sales-tickets';
import { ticketEvents } from '../db/schema/ticket-events';
import { orders } from '../db/schema/orders';
import { auditLogs } from '../db/schema/audit-logs';
import { decryptNullable } from '../lib/crypto';
import { evaluateRules, hasAction, summariseMatches } from '../rules-engine/index';
import { users } from '../db/schema/users';
import { sendError } from '../lib/reply';
import {
  appendTicketEvent,
  notifyTicketStatusChange,
  toTicketOut,
  DEPT_BY_TYPE,
} from '../lib/tickets';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default return/refund eligibility window in days (Q3 confirmed). */
const DEFAULT_WINDOW_DAYS = 30;
const EXTENDED_WINDOW_DAYS = 60;

/** Terminal statuses — no further state transitions allowed. */
const TERMINAL_STATUSES = ['resolved', 'cancelled'] as const;

/** Valid departments for routing/reassignment. */
const DEPARTMENTS = ['front_desk', 'fulfillment', 'accounting'] as const;

// ── Response schemas ──────────────────────────────────────────────────────────

const ticketEventOut = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  eventType: z.string(),
  note: z.string().nullable(),       // plaintext after AES-256-GCM decryption
  fromDept: z.string().nullable(),
  toDept: z.string().nullable(),
  nodeDurationMs: z.number().int().nullable(),
  createdAt: z.string(),
});

const ticketOut = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  department: z.string(),
  assignedTo: z.string().uuid().nullable(),
  receiptReference: z.string().nullable(),
  windowDays: z.number().int(),
  outcome: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ticketDetailOut = ticketOut.extend({
  events: z.array(ticketEventOut),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function ticketRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  function orderAgeExceededWindow(orderCreatedAt: Date, windowDays: number): boolean {
    const ageMs = Date.now() - orderCreatedAt.getTime();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    return ageMs > windowMs;
  }

  /**
   * POST /tickets
   *
   * Customer opens an after-sales ticket linked to a picked-up order.
   *
   * Task 104: creates ticket with initial department from routing table.
   * Task 105: for 'return' and 'refund' types, validates the order was
   *   picked up within the last DEFAULT_WINDOW_DAYS (30) days.
   *   The windowDays field on the ticket records the active window so that
   *   a manager-extended 60-day window (Q3) can be checked at resolution.
   * Task 106: for 'price_adjustment', receiptReference is required (SPEC).
   *   The $50/order cap (Q3) is enforced by the rules engine at resolution
   *   (tasks 122+) since no per-ticket amount is recorded at creation.
   * Task 109: writes immutable audit log on success.
   *
   * Auth: authenticated customer only.
   */
  app.post(
    '/',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('customer'),
      ],
      schema: {
        body: z
          .object({
            orderId: z.string().uuid(),
            type: z.enum(['return', 'refund', 'price_adjustment']),
            /** Required for price_adjustment; omit or null for other types. */
            receiptReference: z.string().min(1).max(255).optional(),
          })
          .superRefine((data, ctx) => {
            if (data.type === 'price_adjustment' && !data.receiptReference?.trim()) {
              ctx.addIssue({
                code: 'custom',
                path: ['receiptReference'],
                message: 'receiptReference is required for price_adjustment tickets (SPEC)',
              });
            }
          }),
        response: { 201: ticketOut },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { orderId, type, receiptReference } = req.body;

      const [order] = await app.db
        .select({ id: orders.id, customerId: orders.customerId, status: orders.status, createdAt: orders.createdAt })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }
      if (order.customerId !== customerId) {
        return sendError(reply, 403, 'You can only open tickets for your own orders.');
      }
      if (order.status !== 'picked_up') {
        return sendError(reply, 409, 'After-sales tickets can only be opened for picked-up orders.');
      }

      // Return/refund eligibility window (default 30 days from order creation).
      if (type === 'return' || type === 'refund') {
        if (orderAgeExceededWindow(order.createdAt, DEFAULT_WINDOW_DAYS)) {
          return sendError(reply, 409, `The ${DEFAULT_WINDOW_DAYS}-day ${type} window has expired for this order.`);
        }
      }

      const [duplicate] = await app.db
        .select({ id: afterSalesTickets.id })
        .from(afterSalesTickets)
        .where(
          and(
            eq(afterSalesTickets.orderId, orderId),
            eq(afterSalesTickets.type, type),
            eq(afterSalesTickets.status, 'open'),
          ),
        )
        .limit(1);

      if (duplicate) {
        return sendError(reply, 409, `An open ${type} ticket already exists for this order.`);
      }

      const department = DEPT_BY_TYPE[type];

      const [ticket] = await app.db
        .insert(afterSalesTickets)
        .values({
          orderId,
          customerId,
          type,
          department,
          receiptReference: receiptReference ?? null,
          windowDays: DEFAULT_WINDOW_DAYS,
        })
        .returning();

      await app.db.insert(auditLogs).values({
        actorId: customerId,
        action: 'ticket.created',
        entityType: 'ticket',
        entityId: ticket.id,
        before: null,
        after: {
          type: ticket.type,
          status: ticket.status,
          orderId: ticket.orderId,
          department: ticket.department,
          windowDays: ticket.windowDays,
          receiptReference: ticket.receiptReference ?? null,
        },
      });

      return reply.status(201).send({
        id: ticket.id,
        orderId: ticket.orderId,
        customerId: ticket.customerId,
        type: ticket.type,
        status: ticket.status,
        department: ticket.department,
        assignedTo: ticket.assignedTo ?? null,
        receiptReference: ticket.receiptReference ?? null,
        windowDays: ticket.windowDays,
        outcome: ticket.outcome ?? null,
        resolvedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : null,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      });
    },
  );

  /**
   * POST /tickets/:id/extend-window
   *
   * Manager override for return/refund tickets: extend eligibility from 30 to
   * 60 days (Q3). Applies only to non-terminal tickets.
   */
  app.post(
    '/:id/extend-window',
    {
      preHandler: [app.requireAuth, app.requireRole('manager', 'admin')],
      schema: {
        params: uuidParam,
        body: z.object({
          note: z.string().max(2000).optional(),
        }),
        response: { 200: ticketOut },
      },
    },
    async (req, reply) => {
      const actorId = req.user!.id;
      const { id } = req.params;

      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (ticket.type !== 'return' && ticket.type !== 'refund') {
        return sendError(reply, 409, 'Window extension is only supported for return/refund tickets.');
      }
      if (TERMINAL_STATUSES.includes(ticket.status as (typeof TERMINAL_STATUSES)[number])) {
        return sendError(reply, 409, `Cannot extend a ticket in terminal status '${ticket.status}'.`);
      }
      if (ticket.windowDays >= EXTENDED_WINDOW_DAYS) {
        return sendError(reply, 409, `Ticket window is already ${EXTENDED_WINDOW_DAYS} days.`);
      }

      const [order] = await app.db
        .select({ createdAt: orders.createdAt })
        .from(orders)
        .where(eq(orders.id, ticket.orderId))
        .limit(1);

      if (!order) return sendError(reply, 404, 'Order not found.');
      if (orderAgeExceededWindow(order.createdAt, EXTENDED_WINDOW_DAYS)) {
        return sendError(reply, 409, `The ${EXTENDED_WINDOW_DAYS}-day extension window has expired for this order.`);
      }

      const now = new Date();
      const [updated] = await app.db.transaction(async (tx) => {
        const event = await appendTicketEvent(tx, {
          ticketId: id,
          actorId,
          eventType: 'note_added',
          note:
            req.body.note?.trim() ||
            `Eligibility window extended from ${ticket.windowDays} to ${EXTENDED_WINDOW_DAYS} days by manager override.`,
        });

        const rows = await tx
          .update(afterSalesTickets)
          .set({ windowDays: EXTENDED_WINDOW_DAYS, updatedAt: now })
          .where(eq(afterSalesTickets.id, id))
          .returning();

        await tx.insert(auditLogs).values({
          actorId,
          action: 'ticket.window_extended',
          entityType: 'ticket',
          entityId: id,
          before: { windowDays: ticket.windowDays },
          after: { windowDays: EXTENDED_WINDOW_DAYS },
          nodeDurationMs: event.nodeDurationMs ?? null,
        });

        return rows;
      });

      return reply.send(toTicketOut(updated));
    },
  );

  /**
   * GET /tickets
   *
   * Customer views their own tickets, newest first, with pagination.
   * Task 107. Auth: authenticated customer.
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('customer')],
      schema: {
        querystring: paginationQuery,
        response: {
          200: z.object({
            data: z.array(ticketOut),
            total: z.number().int(),
            limit: z.number().int(),
            offset: z.number().int(),
          }),
        },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { limit, offset } = req.query;

      const [{ totalCount }] = await app.db
        .select({ totalCount: count() })
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.customerId, customerId));

      const rows = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.customerId, customerId))
        .orderBy(desc(afterSalesTickets.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows.map((t) => ({
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
        })),
        total: totalCount ?? 0,
        limit,
        offset,
      });
    },
  );

  /**
   * GET /tickets/:id
   *
   * Ticket detail with the full immutable event timeline.
   * Notes in ticket_events are stored AES-256-GCM encrypted; decrypted here.
   *
   * Task 108.
   * Auth: customer (own ticket) or any staff.
   */
  app.get(
    '/:id',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        response: { 200: ticketDetailOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const requestingUser = req.user!;
      const isStaff = requestingUser.role !== 'customer';

      // 1. Load ticket
      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) {
        return sendError(reply, 404, 'Ticket not found.');
      }

      if (!isStaff && ticket.customerId !== requestingUser.id) {
        return sendError(reply, 403, 'Access denied.');
      }

      const events = await app.db
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, id))
        .orderBy(ticketEvents.createdAt);

      return reply.send({
        id: ticket.id,
        orderId: ticket.orderId,
        customerId: ticket.customerId,
        type: ticket.type,
        status: ticket.status,
        department: ticket.department,
        assignedTo: ticket.assignedTo ?? null,
        receiptReference: ticket.receiptReference ?? null,
        windowDays: ticket.windowDays,
        outcome: ticket.outcome ?? null,
        resolvedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : null,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        events: events.map((e) => ({
          id: e.id,
          ticketId: e.ticketId,
          actorId: e.actorId ?? null,
          eventType: e.eventType,
          note: decryptNullable(e.note ?? null),
          fromDept: e.fromDept ?? null,
          toDept: e.toDept ?? null,
          nodeDurationMs: e.nodeDurationMs ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    },
  );

  /**
   * POST /tickets/:id/checkin
   *
   * Associate checks in a ticket at the counter; timestamps the node start.
   * Ticket must be 'open'. Sets status → 'in_progress', assignedTo = actor.
   * Appends a 'checked_in' event to the timeline (task 111).
   * Auth: associate+.
   */
  app.post(
    '/:id/checkin',
    {
      preHandler: [app.requireAuth, app.requireRole('associate', 'supervisor', 'manager', 'admin')],
      schema: {
        params: uuidParam,
        body: z.object({ note: z.string().max(2000).optional() }),
        response: { 200: ticketOut },
      },
    },
    async (req, reply) => {
      const actorId = req.user!.id;
      const { id } = req.params;

      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (ticket.status !== 'open') {
        return sendError(reply, 409, `Checkin requires status 'open' (current: '${ticket.status}').`);
      }

      const now = new Date();
      const [updated] = await app.db.transaction(async (tx) => {
        const event = await appendTicketEvent(tx, { ticketId: id, actorId, eventType: 'checked_in', note: req.body.note });
        const rows = await tx
          .update(afterSalesTickets)
          .set({ status: 'in_progress', assignedTo: actorId, updatedAt: now })
          .where(eq(afterSalesTickets.id, id))
          .returning();
        await tx.insert(auditLogs).values({
          actorId,
          action: 'ticket.checked_in',
          entityType: 'ticket',
          entityId: id,
          before: { status: ticket.status },
          after: { status: 'in_progress', assignedTo: actorId },
          nodeDurationMs: event.nodeDurationMs ?? null,
        });
        await notifyTicketStatusChange(tx, { customerId: ticket.customerId, ticketId: id, newStatus: 'in_progress' });
        return rows;
      });

      return reply.send(toTicketOut(updated));
    },
  );

  /**
   * POST /tickets/:id/triage
   *
   * Associate submits triage answers and confirms/overrides the department routing.
   * Task 112 (triage) + Task 113 (routing logic: type → dept table used as default).
   * Ticket must be 'in_progress'. Appends 'triaged' event.
   * Auth: associate+.
   */
  app.post(
    '/:id/triage',
    {
      preHandler: [app.requireAuth, app.requireRole('associate', 'supervisor', 'manager', 'admin')],
      schema: {
        params: uuidParam,
        body: z.object({
          /**
           * Explicit department override. If omitted the routing table
           * (DEPT_BY_TYPE, task 113) is used: return→fulfillment,
           * refund→accounting, price_adjustment→front_desk.
           */
          department: z.enum(DEPARTMENTS).optional(),
          note: z.string().max(2000).optional(),
        }),
        response: { 200: ticketOut },
      },
    },
    async (req, reply) => {
      const actorId = req.user!.id;
      const { id } = req.params;

      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (ticket.status !== 'in_progress') {
        return sendError(reply, 409, `Triage requires status 'in_progress' (current: '${ticket.status}').`);
      }

      const newDept = req.body.department ?? DEPT_BY_TYPE[ticket.type];
      const oldDept = ticket.department;
      const now = new Date();

      const [updated] = await app.db.transaction(async (tx) => {
        const event = await appendTicketEvent(tx, {
          ticketId: id,
          actorId,
          eventType: 'triaged',
          note: req.body.note,
          fromDept: oldDept,
          toDept: newDept,
        });
        const rows = await tx
          .update(afterSalesTickets)
          .set({ department: newDept, updatedAt: now })
          .where(eq(afterSalesTickets.id, id))
          .returning();
        await tx.insert(auditLogs).values({
          actorId,
          action: 'ticket.triaged',
          entityType: 'ticket',
          entityId: id,
          before: { department: oldDept },
          after: { department: newDept },
          nodeDurationMs: event.nodeDurationMs ?? null,
        });
        return rows;
      });

      return reply.send(toTicketOut(updated));
    },
  );

  /**
   * POST /tickets/:id/reassign
   *
   * Supervisor reassigns ticket to a different department.
   * Writes audit log with old/new department (task 114, Q9).
   * Auth: supervisor+.
   */
  app.post(
    '/:id/reassign',
    {
      preHandler: [app.requireAuth, app.requireRole('supervisor', 'manager', 'admin')],
      schema: {
        params: uuidParam,
        body: z.object({
          department: z.enum(DEPARTMENTS),
          note: z.string().max(2000).optional(),
        }),
        response: { 200: ticketOut },
      },
    },
    async (req, reply) => {
      const actorId = req.user!.id;
      const { id } = req.params;
      const { department: newDept, note } = req.body;

      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (TERMINAL_STATUSES.includes(ticket.status as any)) {
        return sendError(reply, 409, `Cannot reassign a ticket with status '${ticket.status}'.`);
      }
      if (ticket.department === newDept) {
        return sendError(reply, 409, `Ticket is already assigned to department '${newDept}'.`);
      }

      const oldDept = ticket.department;
      const now = new Date();

      const [updated] = await app.db.transaction(async (tx) => {
        const event = await appendTicketEvent(tx, {
          ticketId: id, actorId, eventType: 'reassigned', note,
          fromDept: oldDept, toDept: newDept,
        });
        const rows = await tx
          .update(afterSalesTickets)
          .set({ department: newDept, assignedTo: null, updatedAt: now })
          .where(eq(afterSalesTickets.id, id))
          .returning();

        await tx.insert(auditLogs).values({
          actorId,
          action: 'ticket.reassigned',
          entityType: 'ticket',
          entityId: id,
          before: { department: oldDept },
          after: { department: newDept },
          nodeDurationMs: event.nodeDurationMs ?? null,
        });

        return rows;
      });

      return reply.send(toTicketOut(updated));
    },
  );

  /**
   * POST /tickets/:id/interrupt
   *
   * Flag ticket for re-inspection/retest (interruption handling).
   * Ticket must be 'in_progress'. Sets status → 'pending_inspection'.
   * Appends 'interrupted' event (task 115).
   * Auth: associate+.
   */
  app.post(
    '/:id/interrupt',
    {
      preHandler: [app.requireAuth, app.requireRole('associate', 'supervisor', 'manager', 'admin')],
      schema: {
        params: uuidParam,
        body: z.object({ note: z.string().max(2000).optional() }),
        response: { 200: ticketOut },
      },
    },
    async (req, reply) => {
      const actorId = req.user!.id;
      const { id } = req.params;

      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (ticket.status !== 'in_progress') {
        return sendError(reply, 409, `Interrupt requires status 'in_progress' (current: '${ticket.status}').`);
      }

      const now = new Date();
      const [updated] = await app.db.transaction(async (tx) => {
        const event = await appendTicketEvent(tx, { ticketId: id, actorId, eventType: 'interrupted', note: req.body.note });
        const rows = await tx
          .update(afterSalesTickets)
          .set({ status: 'pending_inspection', updatedAt: now })
          .where(eq(afterSalesTickets.id, id))
          .returning();
        await tx.insert(auditLogs).values({
          actorId,
          action: 'ticket.interrupted',
          entityType: 'ticket',
          entityId: id,
          before: { status: ticket.status },
          after: { status: 'pending_inspection' },
          nodeDurationMs: event.nodeDurationMs ?? null,
        });
        await notifyTicketStatusChange(tx, { customerId: ticket.customerId, ticketId: id, newStatus: 'pending_inspection' });
        return rows;
      });

      return reply.send(toTicketOut(updated));
    },
  );

  /**
   * POST /tickets/:id/resolve
   *
   * Close the ticket with an outcome. Ticket must be 'in_progress' or
   * 'pending_inspection'. Sets status → 'resolved', records outcome and
   * resolvedAt. Appends 'resolved' event. Writes audit log (task 116).
   * Auth: associate+.
   */
  app.post(
    '/:id/resolve',
    {
      preHandler: [app.requireAuth, app.requireRole('associate', 'supervisor', 'manager', 'admin')],
      schema: {
        params: uuidParam,
        body: z
          .object({
            outcome: z.enum(['approved', 'rejected', 'adjusted']),
            note: z.string().max(2000).optional(),
            /**
             * Required when ticket.type = 'price_adjustment' and outcome = 'adjusted'.
             * The rules engine checks this against the $50/order cap (task 137, Q3).
             * Top-tier customers may have the cap overridden via an 'override_cap' rule.
             */
            adjustmentAmount: z.number().positive().optional(),
          })
          .superRefine((data, ctx) => {
            if (data.outcome === 'adjusted' && data.adjustmentAmount === undefined) {
              ctx.addIssue({
                code: 'custom',
                path: ['adjustmentAmount'],
                message: 'adjustmentAmount is required when outcome is adjusted',
              });
            }
          }),
        response: { 200: ticketOut },
      },
    },
    async (req, reply) => {
      const actorId = req.user!.id;
      const { id } = req.params;
      const { outcome, note, adjustmentAmount } = req.body;

      const [ticket] = await app.db
        .select()
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (ticket.status !== 'in_progress' && ticket.status !== 'pending_inspection') {
        return sendError(reply, 409, `Resolve requires status 'in_progress' or 'pending_inspection' (current: '${ticket.status}').`);
      }

      if (ticket.type === 'return' || ticket.type === 'refund') {
        const [order] = await app.db
          .select({ createdAt: orders.createdAt })
          .from(orders)
          .where(eq(orders.id, ticket.orderId))
          .limit(1);

        if (!order) return sendError(reply, 404, 'Order not found.');

        if (orderAgeExceededWindow(order.createdAt, ticket.windowDays)) {
          return sendError(
            reply,
            409,
            `The ${ticket.windowDays}-day ${ticket.type} window has expired for this order. Manager extension is required before resolution.`,
          );
        }
      }

      // Rules engine: enforce $50/order cap (Q3). 'block' action vetoes;
      // 'override_cap' allows top-tier bypass (Q3 confirmed).
      if (ticket.type === 'price_adjustment' && outcome === 'adjusted' && adjustmentAmount !== undefined) {
        const [customer] = await app.db
          .select({ tier: users.tier })
          .from(users)
          .where(eq(users.id, ticket.customerId))
          .limit(1);

        const context = {
          'adjustment.amount': adjustmentAmount,
          'customer.tier': customer?.tier ?? 'standard',
          'ticket.id': id,
          'order.id': ticket.orderId,
        };

        const matches = await evaluateRules(app.db, context, { group: 'price_adjustment' });
        const blocked = hasAction(matches, 'block');
        const capOverridden = hasAction(matches, 'override_cap');

        if (blocked && !capOverridden) {
          return sendError(reply, 422, `Price adjustment rejected by rules engine: ${summariseMatches(matches)}`);
        }
      }

      const now = new Date();
      const [updated] = await app.db.transaction(async (tx) => {
        const event = await appendTicketEvent(tx, { ticketId: id, actorId, eventType: 'resolved', note });
        const rows = await tx
          .update(afterSalesTickets)
          .set({ status: 'resolved', outcome, resolvedAt: now, updatedAt: now })
          .where(eq(afterSalesTickets.id, id))
          .returning();

        await tx.insert(auditLogs).values({
          actorId,
          action: 'ticket.resolved',
          entityType: 'ticket',
          entityId: id,
          before: { status: ticket.status, outcome: null },
          after: {
            status: 'resolved',
            outcome,
            resolvedAt: now.toISOString(),
            ...(adjustmentAmount !== undefined ? { adjustmentAmount } : {}),
          },
          nodeDurationMs: event.nodeDurationMs ?? null,
        });

        await notifyTicketStatusChange(tx, { customerId: ticket.customerId, ticketId: id, newStatus: 'resolved' });

        return rows;
      });

      return reply.send(toTicketOut(updated));
    },
  );

  /**
   * GET /tickets/:id/timeline
   *
   * Return all ticket_events for a ticket, ordered chronologically.
   * Each event includes actor, timestamps, nodeDurationMs, and decrypted note.
   * Used to build the timeline view showing per-node durations (Q14, task 117).
   * Auth: customer (own ticket) or staff.
   */
  app.get(
    '/:id/timeline',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        response: { 200: z.array(ticketEventOut) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const requestingUser = req.user!;
      const isStaff = requestingUser.role !== 'customer';

      const [ticket] = await app.db
        .select({ id: afterSalesTickets.id, customerId: afterSalesTickets.customerId })
        .from(afterSalesTickets)
        .where(eq(afterSalesTickets.id, id))
        .limit(1);

      if (!ticket) return sendError(reply, 404, 'Ticket not found.');
      if (!isStaff && ticket.customerId !== requestingUser.id) {
        return sendError(reply, 403, 'Access denied.');
      }

      const events = await app.db
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, id))
        .orderBy(ticketEvents.createdAt);

      return reply.send(
        events.map((e) => ({
          id: e.id,
          ticketId: e.ticketId,
          actorId: e.actorId ?? null,
          eventType: e.eventType,
          note: decryptNullable(e.note ?? null),
          fromDept: e.fromDept ?? null,
          toDept: e.toDept ?? null,
          nodeDurationMs: e.nodeDurationMs ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      );
    },
  );
}


export default ticketRoutes;
