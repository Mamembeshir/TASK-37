/**
 * Integration tests for after-sales ticket routes:
 *   POST   /tickets
 *   GET    /tickets
 *   GET    /tickets/:id
 *   POST   /tickets/:id/checkin
 *   POST   /tickets/:id/triage
 *   POST   /tickets/:id/reassign
 *   POST   /tickets/:id/interrupt
 *   POST   /tickets/:id/extend-window
 *   POST   /tickets/:id/resolve
 *   GET    /tickets/:id/timeline
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { buildTicketTestApp, buildAssociateTestApp } from '../test/app.js';
import { inject } from '../test/client.js';
import {
  seedUser,
  seedOrder,
  seedTicket,
  seedTicketEvent,
  seedNotification,
  seedRule,
} from '../test/helpers.js';
import { afterSalesTickets } from '../db/schema/after-sales-tickets.js';
import { ticketEvents } from '../db/schema/ticket-events.js';
import { notifications } from '../db/schema/notifications.js';
import { auditLogs } from '../db/schema/audit-logs.js';
import { orders } from '../db/schema/orders.js';
import type { FastifyInstance } from 'fastify';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(username: string, password = 'password1234'): Promise<string> {
  const res = await inject(url, {
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  return `Bearer ${res.json().token}`;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  await runMigrations();
  ({ app, url } = await buildTicketTestApp());
});

afterAll(async () => {
  await app.close();
  await clearAllTables();
  await closeDb();
});

// ── POST /tickets ─────────────────────────────────────────────────────────────

describe('POST /tickets', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      payload: { orderId: randomUUID(), type: 'return' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when called by a non-customer role (associate)', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'return' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when order does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: '00000000-0000-0000-0000-000000000001', type: 'return' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when customer opens ticket for another customer\'s order', async () => {
    const owner = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const auth = await loginAs(other.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'return' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when order is not picked_up', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'confirmed' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'return' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/picked.up/i);
  });

  it('returns 400 when price_adjustment is missing receiptReference', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'price_adjustment' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when duplicate open ticket of same type exists', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    await seedTicket({ orderId: order.id, customerId: customer.id, type: 'return', status: 'open' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'return' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already exists/i);
  });

  it('creates return ticket routed to fulfillment (201)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'return' },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.type).toBe('return');
    expect(json.status).toBe('open');
    expect(json.department).toBe('fulfillment');
    expect(json.customerId).toBe(customer.id);
    expect(json.orderId).toBe(order.id);
    expect(json.windowDays).toBe(30);
  });

  it('creates refund ticket routed to accounting (201)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'refund' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().department).toBe('accounting');
  });

  it('creates price_adjustment ticket routed to front_desk with receiptReference (201)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'price_adjustment', receiptReference: 'REC-001' },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.department).toBe('front_desk');
    expect(json.receiptReference).toBe('REC-001');
  });

  it('writes an audit log on ticket creation', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets',
      headers: { authorization: auth },
      payload: { orderId: order.id, type: 'refund' },
    });
    expect(res.statusCode).toBe(201);

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, res.json().id));

    const created = logs.find((l) => l.action === 'ticket.created');
    expect(created).toBeDefined();
    expect(created!.actorId).toBe(customer.id);
  });
});

// ── GET /tickets ──────────────────────────────────────────────────────────────

describe('GET /tickets', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-customer roles', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(associate.username);
    const res = await inject(url, {
      method: 'GET',
      url: '/tickets',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns own tickets only (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const otherOrder = await seedOrder({ customerId: other.id, status: 'picked_up' });
    await seedTicket({ orderId: order.id, customerId: customer.id, type: 'return' });
    await seedTicket({ orderId: otherOrder.id, customerId: other.id, type: 'refund' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/tickets',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json.data)).toBe(true);
    const ids = json.data.map((t: any) => t.customerId);
    expect(ids.every((id: string) => id === customer.id)).toBe(true);
  });

  it('returns paginated results with total count', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order1 = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const order2 = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    await seedTicket({ orderId: order1.id, customerId: customer.id, type: 'return' });
    await seedTicket({ orderId: order2.id, customerId: customer.id, type: 'refund' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/tickets?limit=1&offset=0',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(1);
    expect(json.total).toBeGreaterThanOrEqual(2);
    expect(json.limit).toBe(1);
    expect(json.offset).toBe(0);
  });
});

// ── GET /tickets/:id ──────────────────────────────────────────────────────────

describe('GET /tickets/:id', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/tickets/00000000-0000-0000-0000-000000000001' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when ticket does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(customer.username);
    const res = await inject(url, {
      method: 'GET',
      url: '/tickets/00000000-0000-0000-0000-000000000002',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when customer views another customer\'s ticket', async () => {
    const owner = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: owner.id });
    const auth = await loginAs(other.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns ticket detail with empty events array (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.id).toBe(ticket.id);
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events).toHaveLength(0);
  });

  it('staff can view any customer\'s ticket', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(ticket.id);
  });

  it('decrypts event notes in ticket detail', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    await seedTicketEvent({ ticketId: ticket.id, actorId: associate.id, eventType: 'checked_in', note: 'Sensitive note' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const events = res.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].note).toBe('Sensitive note');
  });
});

// ── POST /tickets/:id/checkin ─────────────────────────────────────────────────

describe('POST /tickets/:id/checkin', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'POST', url: '/tickets/00000000-0000-0000-0000-000000000001/checkin', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when called by customer', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/checkin`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when ticket does not exist', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/tickets/00000000-0000-0000-0000-000000000003/checkin',
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when ticket is not open', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/checkin`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/open/i);
  });

  it('sets status→in_progress, assignedTo=actor, creates event and notification (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/checkin`,
      headers: { authorization: auth },
      payload: { note: 'Customer arrived' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('in_progress');
    expect(json.assignedTo).toBe(associate.id);

    // Event appended
    const events = await testDb
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('checked_in');
    expect(events[0]!.actorId).toBe(associate.id);

    // Notification created for customer
    const notes = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, ticket.id));
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0]!.message).toContain('in_progress');
  });
});

// ── POST /tickets/:id/triage ──────────────────────────────────────────────────

describe('POST /tickets/:id/triage', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'POST', url: '/tickets/00000000-0000-0000-0000-000000000001/triage', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for customer role', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/triage`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when ticket is not in_progress', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'open' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/triage`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/in_progress/i);
  });

  it('uses DEPT_BY_TYPE routing when no department override (return→fulfillment)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, type: 'return', status: 'in_progress', department: 'front_desk' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/triage`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().department).toBe('fulfillment');
  });

  it('uses explicit department override when provided', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, type: 'refund', status: 'in_progress', department: 'accounting' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/triage`,
      headers: { authorization: auth },
      payload: { department: 'front_desk' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().department).toBe('front_desk');
  });

  it('creates triaged event with fromDept and toDept', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, type: 'return', status: 'in_progress', department: 'front_desk' });
    const auth = await loginAs(associate.username);

    await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/triage`,
      headers: { authorization: auth },
      payload: {},
    });

    const events = await testDb
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id));
    const triageEvent = events.find((e) => e.eventType === 'triaged');
    expect(triageEvent).toBeDefined();
    expect(triageEvent!.fromDept).toBe('front_desk');
    expect(triageEvent!.toDept).toBe('fulfillment');
  });
});

// ── POST /tickets/:id/reassign ────────────────────────────────────────────────

describe('POST /tickets/:id/reassign', () => {
  it('returns 403 for associate role (supervisor+ only)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/reassign`,
      headers: { authorization: auth },
      payload: { department: 'accounting' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when ticket is in terminal status (resolved)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const supervisor = await seedUser({ role: 'supervisor' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'resolved', outcome: 'approved' });
    const auth = await loginAs(supervisor.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/reassign`,
      headers: { authorization: auth },
      payload: { department: 'accounting' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/resolved/i);
  });

  it('returns 409 when department is unchanged', async () => {
    const customer = await seedUser({ role: 'customer' });
    const supervisor = await seedUser({ role: 'supervisor' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, department: 'fulfillment', status: 'open' });
    const auth = await loginAs(supervisor.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/reassign`,
      headers: { authorization: auth },
      payload: { department: 'fulfillment' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already/i);
  });

  it('changes department, clears assignedTo, appends reassigned event, writes audit log (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const supervisor = await seedUser({ role: 'supervisor' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, department: 'fulfillment', status: 'in_progress', assignedTo: associate.id });
    const auth = await loginAs(supervisor.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/reassign`,
      headers: { authorization: auth },
      payload: { department: 'accounting', note: 'Moving to accounting' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.department).toBe('accounting');
    expect(json.assignedTo).toBeNull();

    // Audit log
    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ticket.id));
    const reassignLog = logs.find((l) => l.action === 'ticket.reassigned');
    expect(reassignLog).toBeDefined();
    expect(reassignLog!.actorId).toBe(supervisor.id);
  });
});

// ── POST /tickets/:id/interrupt ───────────────────────────────────────────────

describe('POST /tickets/:id/interrupt', () => {
  it('returns 403 for customer role', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/interrupt`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when ticket is not in_progress', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'open' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/interrupt`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('sets status→pending_inspection, appends event, creates notification (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/interrupt`,
      headers: { authorization: auth },
      payload: { note: 'Item needs re-inspection' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending_inspection');

    const events = await testDb
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id));
    expect(events.some((e) => e.eventType === 'interrupted')).toBe(true);

    const notes = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, ticket.id));
    expect(notes.some((n) => n.message.includes('pending_inspection'))).toBe(true);
  });
});

// ── POST /tickets/:id/resolve ─────────────────────────────────────────────────

describe('POST /tickets/:id/resolve', () => {
  it('returns 403 for customer role', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when ticket is not in_progress or pending_inspection', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'open' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when outcome=adjusted but adjustmentAmount is missing', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'adjusted' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('resolves ticket from in_progress with outcome=approved (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'approved', note: 'Return accepted' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('resolved');
    expect(json.outcome).toBe('approved');
    expect(json.resolvedAt).not.toBeNull();
  });

  it('resolves ticket from pending_inspection (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'pending_inspection' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe('rejected');
  });

  it('writes audit log and notification on resolution', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    const auth = await loginAs(associate.username);

    await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'approved' },
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ticket.id));
    expect(logs.some((l) => l.action === 'ticket.resolved')).toBe(true);

    const notes = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, ticket.id));
    expect(notes.some((n) => n.message.includes('resolved'))).toBe(true);
  });

  it('returns 422 when price_adjustment amount exceeds $50 cap (blocked by rules engine)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({
      orderId: order.id,
      customerId: customer.id,
      type: 'price_adjustment',
      status: 'in_progress',
      department: 'front_desk',
      receiptReference: 'REC-CAP',
    });

    // Seed a 'block' rule that fires when adjustment.amount > 50 for non-top-tier
    await seedRule({
      name: `cap_rule_${Date.now()}`,
      status: 'active',
      definitionJson: {
        evaluation_mode: 'serial',
        priority: 1,
        group: 'price_adjustment',
        conditions: {
          type: 'group',
          logic: 'AND',
          conditions: [
            { type: 'leaf', field: 'adjustment.amount', operator: 'gt', value: 50 },
            { type: 'leaf', field: 'customer.tier', operator: 'not_in', value: ['top'] },
          ],
        },
        actions: [{ type: 'block', params: { reason: 'Exceeds $50 cap' } }],
      },
      createdBy: admin.id,
    });

    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'adjusted', adjustmentAmount: 75 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/rules engine|block/i);
  });

  it('returns 409 when return/refund resolution is beyond ticket window', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({
      orderId: order.id,
      customerId: customer.id,
      type: 'return',
      status: 'in_progress',
      windowDays: 30,
    });

    await testDb
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(orders.id, order.id));

    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: auth },
      payload: { outcome: 'approved' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/extension is required|window has expired/i);
  });

  it('allows resolution after manager extends window to 60 days', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const manager = await seedUser({ role: 'manager' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({
      orderId: order.id,
      customerId: customer.id,
      type: 'refund',
      status: 'in_progress',
      windowDays: 30,
    });

    await testDb
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) })
      .where(eq(orders.id, order.id));

    const managerAuth = await loginAs(manager.username);
    const extendRes = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/extend-window`,
      headers: { authorization: managerAuth },
      payload: { note: 'Approve extension to 60 days' },
    });
    expect(extendRes.statusCode).toBe(200);
    expect(extendRes.json().windowDays).toBe(60);

    const associateAuth = await loginAs(associate.username);
    const resolveRes = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/resolve`,
      headers: { authorization: associateAuth },
      payload: { outcome: 'approved' },
    });

    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().status).toBe('resolved');
  });
});

// ── POST /tickets/:id/extend-window ───────────────────────────────────────────

describe('POST /tickets/:id/extend-window', () => {
  it('returns 403 for associate role', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, type: 'return', status: 'open' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/extend-window`,
      headers: { authorization: auth },
      payload: { note: 'please extend' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('extends return/refund ticket window to 60 days for manager (200)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const manager = await seedUser({ role: 'manager' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, type: 'refund', status: 'in_progress' });
    const auth = await loginAs(manager.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/extend-window`,
      headers: { authorization: auth },
      payload: { note: 'Manager approved 60-day extension' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().windowDays).toBe(60);

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ticket.id));
    expect(logs.some((l) => l.action === 'ticket.window_extended')).toBe(true);

    const events = await testDb
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id));
    expect(events.some((e) => e.eventType === 'note_added')).toBe(true);
  });

  it('returns 409 for non-return/refund ticket types', async () => {
    const customer = await seedUser({ role: 'customer' });
    const manager = await seedUser({ role: 'manager' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({
      orderId: order.id,
      customerId: customer.id,
      type: 'price_adjustment',
      status: 'open',
      department: 'front_desk',
      receiptReference: 'REC-123',
    });
    const auth = await loginAs(manager.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/extend-window`,
      headers: { authorization: auth },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
  });
});

// ── GET /tickets/:id/timeline ─────────────────────────────────────────────────

describe('GET /tickets/:id/timeline', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/tickets/00000000-0000-0000-0000-000000000001/timeline' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when ticket does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(customer.username);
    const res = await inject(url, {
      method: 'GET',
      url: '/tickets/00000000-0000-0000-0000-000000000004/timeline',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for another customer\'s timeline', async () => {
    const owner = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: owner.id });
    const auth = await loginAs(other.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}/timeline`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns empty array when no events', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}/timeline`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns events in chronological order with all required fields', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'in_progress' });
    await seedTicketEvent({ ticketId: ticket.id, actorId: associate.id, eventType: 'checked_in' });
    await seedTicketEvent({ ticketId: ticket.id, actorId: associate.id, eventType: 'triaged', nodeDurationMs: 5000 });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}/timeline`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('checked_in');
    expect(events[1].eventType).toBe('triaged');
    expect(events[1].nodeDurationMs).toBe(5000);

    // Verify required shape fields
    const e = events[0];
    expect(e).toHaveProperty('id');
    expect(e).toHaveProperty('ticketId');
    expect(e).toHaveProperty('actorId');
    expect(e).toHaveProperty('eventType');
    expect(e).toHaveProperty('note');
    expect(e).toHaveProperty('fromDept');
    expect(e).toHaveProperty('toDept');
    expect(e).toHaveProperty('nodeDurationMs');
    expect(e).toHaveProperty('createdAt');
  });

  it('second event has positive nodeDurationMs after real checkin + triage flow', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(associate.username);

    // Checkin via API (creates first event)
    await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/checkin`,
      headers: { authorization: auth },
      payload: {},
    });

    // Triage via API (creates second event with nodeDurationMs)
    await inject(url, {
      method: 'POST',
      url: `/tickets/${ticket.id}/triage`,
      headers: { authorization: auth },
      payload: {},
    });

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}/timeline`,
      headers: { authorization: auth },
    });
    const events = res.json();
    expect(events).toHaveLength(2);
    expect(events[0].nodeDurationMs).toBeNull(); // first event
    expect(events[1].nodeDurationMs).toBeGreaterThanOrEqual(0); // second event
  });

  it('staff can view timeline for any ticket', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    await seedTicketEvent({ ticketId: ticket.id, actorId: associate.id, eventType: 'checked_in' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/tickets/${ticket.id}/timeline`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
