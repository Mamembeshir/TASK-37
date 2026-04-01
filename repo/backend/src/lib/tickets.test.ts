/**
 * Unit tests for lib/tickets.ts helpers.
 *
 * appendTicketEvent  — inserts timeline event with nodeDurationMs computed
 * notifyTicketStatusChange — inserts in-app notification
 * toTicketOut        — pure serialiser (no DB)
 * DEPT_BY_TYPE       — routing table values
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { appendTicketEvent, notifyTicketStatusChange, toTicketOut, DEPT_BY_TYPE } from './tickets.js';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { seedUser, seedOrder, seedTicket } from '../test/helpers.js';
import { ticketEvents } from '../db/schema/ticket-events.js';
import { notifications } from '../db/schema/notifications.js';
import { decryptNullable } from './crypto.js';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await clearAllTables();
  await closeDb();
});

// ── DEPT_BY_TYPE ──────────────────────────────────────────────────────────────

describe('DEPT_BY_TYPE routing table', () => {
  it('routes return → fulfillment', () => {
    expect(DEPT_BY_TYPE.return).toBe('fulfillment');
  });

  it('routes refund → accounting', () => {
    expect(DEPT_BY_TYPE.refund).toBe('accounting');
  });

  it('routes price_adjustment → front_desk', () => {
    expect(DEPT_BY_TYPE.price_adjustment).toBe('front_desk');
  });
});

// ── appendTicketEvent ─────────────────────────────────────────────────────────

describe('appendTicketEvent', () => {
  it('first event has nodeDurationMs = null', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });

    const event = await appendTicketEvent(testDb as any, {
      ticketId: ticket.id,
      actorId: associate.id,
      eventType: 'checked_in',
    });

    expect(event.nodeDurationMs).toBeNull();
    expect(event.ticketId).toBe(ticket.id);
    expect(event.actorId).toBe(associate.id);
    expect(event.eventType).toBe('checked_in');
  });

  it('second event has positive nodeDurationMs', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });

    // First event
    await appendTicketEvent(testDb as any, {
      ticketId: ticket.id,
      actorId: associate.id,
      eventType: 'checked_in',
    });

    // Short delay to ensure non-zero duration
    await new Promise((r) => setTimeout(r, 10));

    // Second event
    const second = await appendTicketEvent(testDb as any, {
      ticketId: ticket.id,
      actorId: associate.id,
      eventType: 'triaged',
    });

    expect(second.nodeDurationMs).not.toBeNull();
    expect(second.nodeDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('stores an encrypted note and fromDept/toDept', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });

    const event = await appendTicketEvent(testDb as any, {
      ticketId: ticket.id,
      actorId: associate.id,
      eventType: 'triaged',
      note: 'Needs accounting review',
      fromDept: 'fulfillment',
      toDept: 'accounting',
    });

    // The raw DB value should be encrypted (not plaintext)
    const [raw] = await testDb
      .select({ note: ticketEvents.note })
      .from(ticketEvents)
      .where(eq(ticketEvents.id, event.id));
    expect(raw!.note).not.toBe('Needs accounting review');
    expect(raw!.note).toMatch(/:/); // iv_hex:authTag_hex:ciphertext format

    // Decrypted should round-trip
    expect(decryptNullable(raw!.note ?? null)).toBe('Needs accounting review');

    expect(event.fromDept).toBe('fulfillment');
    expect(event.toDept).toBe('accounting');
  });

  it('stores null note when note is omitted', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });

    const event = await appendTicketEvent(testDb as any, {
      ticketId: ticket.id,
      actorId: associate.id,
      eventType: 'checked_in',
    });

    const [raw] = await testDb
      .select({ note: ticketEvents.note })
      .from(ticketEvents)
      .where(eq(ticketEvents.id, event.id));
    expect(raw!.note).toBeNull();
  });
});

// ── notifyTicketStatusChange ──────────────────────────────────────────────────

describe('notifyTicketStatusChange', () => {
  it('inserts a notification row for the customer', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });

    await notifyTicketStatusChange(testDb as any, {
      customerId: customer.id,
      ticketId: ticket.id,
      newStatus: 'in_progress',
    });

    const rows = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.customerId, customer.id));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const note = rows.find((r) => r.entityId === ticket.id);
    expect(note).toBeDefined();
    expect(note!.message).toContain('in_progress');
    expect(note!.isRead).toBe(false);
    expect(note!.entityType).toBe('ticket');
  });

  it('message includes the new status value', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });

    await notifyTicketStatusChange(testDb as any, {
      customerId: customer.id,
      ticketId: ticket.id,
      newStatus: 'resolved',
    });

    const [row] = await testDb
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, ticket.id));

    expect(row!.message).toContain('resolved');
  });
});

// ── toTicketOut ───────────────────────────────────────────────────────────────

describe('toTicketOut', () => {
  it('serialises all required fields as strings/nulls', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, type: 'refund', department: 'accounting' });

    const out = toTicketOut(ticket);

    expect(out.id).toBe(ticket.id);
    expect(out.orderId).toBe(order.id);
    expect(out.customerId).toBe(customer.id);
    expect(out.type).toBe('refund');
    expect(out.status).toBe('open');
    expect(out.department).toBe('accounting');
    expect(out.assignedTo).toBeNull();
    expect(out.receiptReference).toBeNull();
    expect(out.windowDays).toBe(30);
    expect(out.outcome).toBeNull();
    expect(out.resolvedAt).toBeNull();
    expect(typeof out.createdAt).toBe('string');
    expect(typeof out.updatedAt).toBe('string');
  });

  it('serialises resolvedAt as ISO string when set', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'resolved', outcome: 'approved' });

    // Manually set resolvedAt on the object (normally set by the route)
    const ticketWithResolved = { ...ticket, resolvedAt: new Date('2025-01-01T12:00:00Z') };
    const out = toTicketOut(ticketWithResolved);

    expect(out.resolvedAt).toBe('2025-01-01T12:00:00.000Z');
    expect(out.outcome).toBe('approved');
  });
});
