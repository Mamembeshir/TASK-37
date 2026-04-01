/**
 * Integration tests for notification routes:
 *   GET /notifications         — own unread notifications, newest first
 *   PUT /notifications/:id/read — mark own notification as read
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { buildTicketTestApp } from '../test/app.js';
import { seedUser, seedOrder, seedTicket, seedNotification } from '../test/helpers.js';
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
  app = await buildTicketTestApp();
});

afterAll(async () => {
  await app.close();
  await clearAllTables();
  await closeDb();
});

// ── GET /notifications ────────────────────────────────────────────────────────

describe('GET /notifications', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with empty array when customer has no notifications', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns own unread notifications', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    await seedNotification({
      customerId: customer.id,
      message: "Your ticket status has been updated to 'in_progress'.",
      entityType: 'ticket',
      entityId: ticket.id,
      isRead: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body: Array<{ entityId: string; message: string; isRead: boolean }> = res.json();
    const note = body.find((n) => n.entityId === ticket.id);
    expect(note).toBeDefined();
    expect(note!.message).toContain('in_progress');
    expect(note!.isRead).toBe(false);
  });

  it('excludes read notifications', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    await seedNotification({
      customerId: customer.id,
      message: "Your ticket status has been updated to 'resolved'.",
      entityType: 'ticket',
      entityId: ticket.id,
      isRead: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body: Array<{ entityId: string }> = res.json();
    // The read notification must not appear
    expect(body.every((n) => n.entityId !== ticket.id)).toBe(true);
  });

  it('does not return other users notifications', async () => {
    const customer1 = await seedUser({ role: 'customer' });
    const customer2 = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer2.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer2.id });
    const auth = await loginAs(app, customer1.username);

    await seedNotification({
      customerId: customer2.id,
      message: "Your ticket status has been updated to 'resolved'.",
      entityType: 'ticket',
      entityId: ticket.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body: Array<{ entityId: string }> = res.json();
    // customer2's notification must not appear for customer1
    expect(body.every((n) => n.entityId !== ticket.id)).toBe(true);
  });

  it('returns correct notification shape', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    await seedNotification({
      customerId: customer.id,
      message: "Your ticket status has been updated to 'in_progress'.",
      entityType: 'ticket',
      entityId: ticket.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body: Array<Record<string, unknown>> = res.json();
    const note = body.find((n) => n.entityId === ticket.id);
    expect(note).toBeDefined();
    expect(typeof note!.id).toBe('string');
    expect(note!.customerId).toBe(customer.id);
    expect(typeof note!.message).toBe('string');
    expect(note!.entityType).toBe('ticket');
    expect(note!.entityId).toBe(ticket.id);
    expect(note!.isRead).toBe(false);
    expect(typeof note!.createdAt).toBe('string');
  });

  it('staff can also receive and read own notifications', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(app, associate.username);

    await seedNotification({
      customerId: associate.id,
      message: 'A ticket has been assigned to you.',
      entityType: 'ticket',
      entityId: randomUUID(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body: Array<{ message: string }> = res.json();
    const note = body.find((n) => n.message === 'A ticket has been assigned to you.');
    expect(note).toBeDefined();
  });
});

// ── PUT /notifications/:id/read ───────────────────────────────────────────────

describe('PUT /notifications/:id/read', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/notifications/${randomUUID()}/read`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when notification does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'PUT',
      url: `/notifications/${randomUUID()}/read`,
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/i);
  });

  it('returns 403 when trying to mark another users notification as read', async () => {
    const customer1 = await seedUser({ role: 'customer' });
    const customer2 = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer1.username);

    const notification = await seedNotification({
      customerId: customer2.id,
      message: "Your ticket status has been updated to 'resolved'.",
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/notifications/${notification.id}/read`,
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/access denied/i);
  });

  it('marks own notification as read and returns updated row', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const notification = await seedNotification({
      customerId: customer.id,
      message: "Your ticket status has been updated to 'resolved'.",
      entityType: 'ticket',
      entityId: ticket.id,
      isRead: false,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/notifications/${notification.id}/read`,
      headers: { authorization: auth },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(notification.id);
    expect(body.isRead).toBe(true);
    expect(body.customerId).toBe(customer.id);
    expect(body.entityType).toBe('ticket');
    expect(body.entityId).toBe(ticket.id);
    expect(typeof body.createdAt).toBe('string');
  });

  it('marking an already-read notification is idempotent', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);

    const notification = await seedNotification({
      customerId: customer.id,
      message: 'Already read notification.',
      isRead: true,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/notifications/${notification.id}/read`,
      headers: { authorization: auth },
    });

    // Should succeed and still return isRead: true
    expect(res.statusCode).toBe(200);
    expect(res.json().isRead).toBe(true);
  });

  it('notification no longer appears in GET /notifications after being marked read', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const ticket = await seedTicket({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const notification = await seedNotification({
      customerId: customer.id,
      message: "Your ticket status has been updated to 'in_progress'.",
      entityType: 'ticket',
      entityId: ticket.id,
      isRead: false,
    });

    // Mark as read
    const markRes = await app.inject({
      method: 'PUT',
      url: `/notifications/${notification.id}/read`,
      headers: { authorization: auth },
    });
    expect(markRes.statusCode).toBe(200);

    // GET should now exclude it
    const listRes = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: auth },
    });

    expect(listRes.statusCode).toBe(200);
    const body: Array<{ id: string }> = listRes.json();
    expect(body.every((n) => n.id !== notification.id)).toBe(true);
  });
});
