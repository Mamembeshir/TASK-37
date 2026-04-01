/**
 * Integration tests for the associate queue route:
 *   GET /associate/tickets
 *
 * Tests: 401 unauth, 403 customer, 200 empty, 200 active tickets,
 *        department filter, pagination, terminal tickets excluded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { buildAssociateTestApp } from '../test/app.js';
import { seedUser, seedOrder, seedTicket } from '../test/helpers.js';
import type { FastifyInstance } from 'fastify';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(app: FastifyInstance, username: string, password = 'password1234'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  return `Bearer ${res.json().token}`;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations();
  app = await buildAssociateTestApp();
});

afterAll(async () => {
  await app.close();
  await clearAllTables();
  await closeDb();
});

// ── GET /associate/tickets ────────────────────────────────────────────────────

describe('GET /associate/tickets', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/associate/tickets' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for customer role', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with empty data when no tickets exist', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('returns active (non-terminal) tickets only', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, associate.username);

    const order1 = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const order2 = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const order3 = await seedOrder({ customerId: customer.id, status: 'picked_up' });

    const openTicket = await seedTicket({ orderId: order1.id, customerId: customer.id, status: 'open' });
    const inProgressTicket = await seedTicket({ orderId: order2.id, customerId: customer.id, status: 'in_progress' });
    await seedTicket({ orderId: order3.id, customerId: customer.id, status: 'resolved', outcome: 'approved' });

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    const ids = body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(openTicket.id);
    expect(ids).toContain(inProgressTicket.id);
    // resolved ticket must not appear
    expect(body.data.every((t: { status: string }) => t.status !== 'resolved')).toBe(true);
  });

  it('excludes cancelled tickets', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, associate.username);

    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const cancelledTicket = await seedTicket({ orderId: order.id, customerId: customer.id, status: 'cancelled' });

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.data.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(cancelledTicket.id);
  });

  it('filters by department when department param is provided', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, associate.username);

    const order1 = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const order2 = await seedOrder({ customerId: customer.id, status: 'picked_up' });

    const fulfillmentTicket = await seedTicket({
      orderId: order1.id,
      customerId: customer.id,
      department: 'fulfillment',
      type: 'return',
    });
    await seedTicket({
      orderId: order2.id,
      customerId: customer.id,
      department: 'accounting',
      type: 'refund',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets?department=fulfillment',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // All returned tickets must be fulfillment dept
    expect(body.data.every((t: { department: string }) => t.department === 'fulfillment')).toBe(true);
    const ids = body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(fulfillmentTicket.id);
  });

  it('rejects an invalid department value with 400', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets?department=invalid_dept',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(400);
  });

  it('paginates results correctly', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, associate.username);

    // Seed 3 open tickets in accounting dept to isolate from other tests
    for (let i = 0; i < 3; i++) {
      const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
      await seedTicket({ orderId: order.id, customerId: customer.id, department: 'accounting', type: 'refund' });
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/associate/tickets?department=accounting&limit=2&offset=0',
      headers: { authorization: auth },
    });

    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.data.length).toBe(2);
    expect(body1.limit).toBe(2);
    expect(body1.offset).toBe(0);
    expect(body1.total).toBeGreaterThanOrEqual(3);

    const page2 = await app.inject({
      method: 'GET',
      url: '/associate/tickets?department=accounting&limit=2&offset=2',
      headers: { authorization: auth },
    });

    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.data.length).toBeGreaterThanOrEqual(1);
    expect(body2.offset).toBe(2);
  });

  it('is accessible by supervisor role', async () => {
    const supervisor = await seedUser({ role: 'supervisor' });
    const auth = await loginAs(app, supervisor.username);

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
  });

  it('is accessible by manager role', async () => {
    const manager = await seedUser({ role: 'manager' });
    const auth = await loginAs(app, manager.username);

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns correct shape for each ticket item', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, associate.username);

    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({
      orderId: order.id,
      customerId: customer.id,
      type: 'return',
      department: 'fulfillment',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const item = body.data.find((t: { id: string }) => t.id === ticket.id);
    expect(item).toBeDefined();
    expect(item.id).toBe(ticket.id);
    expect(item.orderId).toBe(order.id);
    expect(item.customerId).toBe(customer.id);
    expect(item.type).toBe('return');
    expect(item.status).toBe('open');
    expect(item.department).toBe('fulfillment');
    expect(item.assignedTo).toBeNull();
    expect(item.receiptReference).toBeNull();
    expect(item.windowDays).toBe(30);
    expect(item.outcome).toBeNull();
    expect(item.resolvedAt).toBeNull();
    expect(typeof item.createdAt).toBe('string');
    expect(typeof item.updatedAt).toBe('string');
  });

  it('includes pending_inspection tickets as active', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, associate.username);

    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({
      orderId: order.id,
      customerId: customer.id,
      status: 'pending_inspection',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/associate/tickets',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(ticket.id);
  });
});
