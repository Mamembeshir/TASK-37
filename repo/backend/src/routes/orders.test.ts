/**
 * Order integration tests.
 *
 * Covers:
 *   POST /orders            — cart-to-order, out-of-stock, audit log, pickup code
 *   GET  /orders            — list own orders, pagination, RBAC
 *   GET  /orders/:id        — detail with items / groups / splits, RBAC
 *   POST /orders/:id/tender — cash/card splits, currency, validation
 *   POST /orders/:id/confirm— tender total vs order total, status transition
 *   POST /orders/:id/pickup/verify          — code check, attempt counter, lock
 *   POST /orders/:id/pickup/manager-override— locked order, manager credentials
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildOrderTestApp } from '../test/app.js';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import {
  seedUser,
  seedProduct,
  seedCart,
  seedCartItem,
  seedOrder,
  seedOrderWithCode,
  seedOrderItem,
  seedTenderSplit,
} from '../test/helpers.js';
import { orders } from '../db/schema/orders.js';
import { products } from '../db/schema/products.js';
import { auditLogs } from '../db/schema/audit-logs.js';
import { tenderSplits } from '../db/schema/tender-splits.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(
  app: FastifyInstance,
  username: string,
  password = 'password1234',
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return `Bearer ${res.json().token as string}`;
}

function authHeader(token: string) {
  return token ? { authorization: token } : {};
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations();
  app = await buildOrderTestApp();
});

beforeEach(async () => {
  await clearAllTables();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ── POST /orders ───────────────────────────────────────────────────────────────

describe('POST /orders', () => {
  it('401: requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/orders' });
    expect(res.statusCode).toBe(401);
  });

  it('404: no active cart', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/no active cart/i);
  });

  it('410: expired cart', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    await seedCart({ customerId: user.id, expiresAt: new Date(Date.now() - 1000) });

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toMatch(/expired/i);
  });

  it('400: empty cart', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    await seedCart({ customerId: user.id });

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/empty cart/i);
  });

  it('201: creates order from active cart — response shape', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ price: '19.99', stockQty: 10 });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: product.id, qty: 2 });

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      customerId: user.id,
      status: 'pending',
    });
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: product.id,
      qty: 2,
      unitPrice: '19.99',
      cancelledAt: null,
      cancellationReason: null,
    });
  });

  it('201: pickupCode is exactly 6 digits', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ stockQty: 5 });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: product.id, qty: 1 });

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });

    expect(res.statusCode).toBe(201);
    expect(res.json().pickupCode).toMatch(/^\d{6}$/);
  });

  it('201: cart status changes to "converted"', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ stockQty: 5 });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: product.id, qty: 1 });

    await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });

    const [updatedCart] = await testDb
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.customerId, user.id));
    // The cart (not order) status check — let's read from carts table indirectly
    // by confirming a second POST /orders returns 404 (no active cart)
    const res2 = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    expect(res2.statusCode).toBe(404); // cart was converted, no active cart remains
    void updatedCart; // suppress unused warning
  });

  it('201: audit log written with action "order.created"', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ stockQty: 5 });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: product.id, qty: 1 });

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    const orderId = res.json().id;

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, orderId));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('order.created');
    expect(logs[0]!.actorId).toBe(user.id);
    expect(logs[0]!.entityType).toBe('order');
  });

  it('201: pickupCode is NOT included in subsequent GET /orders/:id', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ stockQty: 5 });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: product.id, qty: 1 });

    const createRes = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    const orderId = createRes.json().id;

    const getRes = await app.inject({
      method: 'GET',
      url: `/orders/${orderId}`,
      headers: authHeader(auth),
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('pickupCode');
    expect(body).not.toHaveProperty('pickupCodeIndex');
  });

  it('201: inactive items are cancelled with reason "product_unavailable" and stock released', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const activeProduct = await seedProduct({ stockQty: 10, name: 'Active Widget' });
    const inactiveProduct = await seedProduct({ stockQty: 5, name: 'Gone Widget' });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: activeProduct.id, qty: 2 });
    await seedCartItem({ cartId: cart.id, productId: inactiveProduct.id, qty: 3 });

    // Make one product inactive between cart creation and order time
    await testDb
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, inactiveProduct.id));

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.items).toHaveLength(2);

    const activeItem = body.items.find((i: { productId: string }) => i.productId === activeProduct.id);
    const cancelledItem = body.items.find((i: { productId: string }) => i.productId === inactiveProduct.id);

    expect(activeItem).toMatchObject({ cancelledAt: null, cancellationReason: null });
    expect(cancelledItem).toMatchObject({ cancellationReason: 'product_unavailable' });
    expect(cancelledItem.cancelledAt).not.toBeNull();

    // Stock for the cancelled item should be restored.
    // seedCartItem is a direct DB insert — it does NOT decrement stock.
    // The order route unconditionally releases qty for cancelled items.
    // stockQty started at 5; order release adds 3 → 8.
    const [row] = await testDb
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(eq(products.id, inactiveProduct.id));
    expect(row!.stockQty).toBe(8);
  });

  it('409: all items inactive', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ stockQty: 5 });
    const cart = await seedCart({ customerId: user.id });
    await seedCartItem({ cartId: cart.id, productId: product.id, qty: 1 });
    await testDb.update(products).set({ isActive: false }).where(eq(products.id, product.id));

    const res = await app.inject({ method: 'POST', url: '/orders', headers: authHeader(auth) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/no longer available/i);
  });
});

// ── GET /orders ────────────────────────────────────────────────────────────────

describe('GET /orders', () => {
  it('401: requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders' });
    expect(res.statusCode).toBe(401);
  });

  it('200: empty list when no orders', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);

    const res = await app.inject({ method: 'GET', url: '/orders', headers: authHeader(auth) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.limit).toBeGreaterThan(0);
    expect(body.offset).toBe(0);
  });

  it('200: returns own orders with correct shape', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    await seedOrder({ customerId: user.id });
    await seedOrder({ customerId: user.id });

    const res = await app.inject({ method: 'GET', url: '/orders', headers: authHeader(auth) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      customerId: user.id,
      status: 'pending',
    });
    expect(body.data[0].id).toBeDefined();
    expect(body.data[0].createdAt).toBeDefined();
    // pickupCode must NOT be in the list response
    expect(body.data[0]).not.toHaveProperty('pickupCode');
  });

  it('200: only returns the authenticated customer\'s own orders', async () => {
    const u1 = await seedUser({ username: 'orderuser1' });
    const u2 = await seedUser({ username: 'orderuser2' });
    await seedOrder({ customerId: u1.id });
    await seedOrder({ customerId: u2.id });

    const auth1 = await loginAs(app, u1.username);
    const res = await app.inject({ method: 'GET', url: '/orders', headers: authHeader(auth1) });

    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    expect(res.json().data[0].customerId).toBe(u1.id);
  });

  it('200: pagination — limit and offset', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    for (let i = 0; i < 3; i++) await seedOrder({ customerId: user.id });

    const res = await app.inject({
      method: 'GET',
      url: '/orders?limit=2&offset=0',
      headers: authHeader(auth),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.data).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });
});

// ── GET /orders/:id ────────────────────────────────────────────────────────────

describe('GET /orders/:id', () => {
  it('401: requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders/00000000-0000-0000-0000-000000000001' });
    expect(res.statusCode).toBe(401);
  });

  it('404: order not found', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const res = await app.inject({
      method: 'GET',
      url: '/orders/00000000-0000-0000-0000-000000000001',
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(404);
  });

  it('403: customer cannot view another customer\'s order', async () => {
    const owner = await seedUser({ username: 'owner_ord' });
    const other = await seedUser({ username: 'other_ord' });
    const order = await seedOrder({ customerId: owner.id });

    const otherAuth = await loginAs(app, other.username);
    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: authHeader(otherAuth),
    });
    expect(res.statusCode).toBe(403);
  });

  it('200: customer can view own order — full detail shape', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const product = await seedProduct({ name: 'Test Widget', price: '14.99' });
    const order = await seedOrder({ customerId: user.id });
    await seedOrderItem({ orderId: order.id, productId: product.id, qty: 2, unitPrice: '14.99' });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: authHeader(auth),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(order.id);
    expect(body.customerId).toBe(user.id);
    expect(body.status).toBe('pending');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: product.id,
      productName: 'Test Widget',
      qty: 2,
      unitPrice: '14.99',
      cancelledAt: null,
      cancellationReason: null,
      pickupGroupId: null,
    });
    expect(Array.isArray(body.pickupGroups)).toBe(true);
    expect(Array.isArray(body.tenderSplits)).toBe(true);
    expect(body).not.toHaveProperty('pickupCode');
    expect(body).not.toHaveProperty('pickupCodeIndex');
  });

  it('200: associate (staff) can view any order', async () => {
    const customer = await seedUser({ username: 'cust_viewtest' });
    const associate = await seedUser({ username: 'assoc_viewtest', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });

    const assocAuth = await loginAs(app, associate.username);
    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: authHeader(assocAuth),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(order.id);
  });

  it('400: non-UUID id returns 400', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const res = await app.inject({
      method: 'GET',
      url: '/orders/not-a-uuid',
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(400);
  });

  it('200: includes tender splits when present', async () => {
    const user = await seedUser();
    const auth = await loginAs(app, user.username);
    const order = await seedOrder({ customerId: user.id });
    await seedTenderSplit({ orderId: order.id, method: 'cash', amount: '20.00' });

    const res = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenderSplits).toHaveLength(1);
    expect(res.json().tenderSplits[0]).toMatchObject({ method: 'cash', amount: '20.00' });
  });
});

// ── POST /orders/:id/tender ────────────────────────────────────────────────────

describe('POST /orders/:id/tender', () => {
  it('401: requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/tender',
      payload: { method: 'cash', amount: '10.00' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403: customer role cannot record tender', async () => {
    const customer = await seedUser({ username: 'cust_tender' });
    const order = await seedOrder({ customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(auth),
      payload: { method: 'cash', amount: '10.00' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404: order not found', async () => {
    const associate = await seedUser({ username: 'assoc_tender1', role: 'associate' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/tender',
      headers: authHeader(auth),
      payload: { method: 'cash', amount: '10.00' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('201: records a cash tender split', async () => {
    const customer = await seedUser({ username: 'cust_cash' });
    const associate = await seedUser({ username: 'assoc_cash', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '25.00' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      orderId: order.id,
      method: 'cash',
      amount: '25.00',
      reference: null,
    });
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('201: records a card tender split with reference', async () => {
    const customer = await seedUser({ username: 'cust_card' });
    const associate = await seedUser({ username: 'assoc_card', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'card', amount: '50.00', reference: 'TXN-ABC-123' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ method: 'card', reference: 'TXN-ABC-123' });
  });

  it('201: audit log written with action "tender.recorded"', async () => {
    const customer = await seedUser({ username: 'cust_auditend' });
    const associate = await seedUser({ username: 'assoc_audittender', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '10.00' },
    });
    const splitId = res.json().id;

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, splitId));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('tender.recorded');
    expect(logs[0]!.actorId).toBe(associate.id);
  });

  it('400: card tender requires a reference', async () => {
    const customer = await seedUser({ username: 'cust_noref' });
    const associate = await seedUser({ username: 'assoc_noref', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'card', amount: '10.00' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400: cash tender must not have a reference', async () => {
    const customer = await seedUser({ username: 'cust_cashref' });
    const associate = await seedUser({ username: 'assoc_cashref', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '10.00', reference: 'SHOULD-NOT-BE-HERE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400: amount must be greater than zero', async () => {
    const customer = await seedUser({ username: 'cust_zeroamt' });
    const associate = await seedUser({ username: 'assoc_zeroamt', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400: foreign currency is rejected', async () => {
    const customer = await seedUser({ username: 'cust_eur' });
    const associate = await seedUser({ username: 'assoc_eur', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '10.00', currency: 'EUR' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message ?? res.json().error ?? JSON.stringify(res.json())).toMatch(
      /only local currency|USD/i,
    );
  });

  it('400: USD currency is accepted', async () => {
    const customer = await seedUser({ username: 'cust_usd' });
    const associate = await seedUser({ username: 'assoc_usd', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '15.00', currency: 'USD' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('409: cannot record tender on a picked_up order', async () => {
    const customer = await seedUser({ username: 'cust_pickedup' });
    const associate = await seedUser({ username: 'assoc_pickedup', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '10.00' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('409: cannot record tender on a cancelled order', async () => {
    const customer = await seedUser({ username: 'cust_cancelled' });
    const associate = await seedUser({ username: 'assoc_cancelled', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'cancelled' });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/tender`,
      headers: authHeader(assocAuth),
      payload: { method: 'cash', amount: '10.00' },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── POST /orders/:id/confirm ───────────────────────────────────────────────────

describe('POST /orders/:id/confirm', () => {
  it('401: requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/confirm',
    });
    expect(res.statusCode).toBe(401);
  });

  it('403: customer role cannot confirm', async () => {
    const customer = await seedUser({ username: 'cust_conf' });
    const order = await seedOrder({ customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/confirm`,
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404: order not found', async () => {
    const associate = await seedUser({ username: 'assoc_conf404', role: 'associate' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/confirm',
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(404);
  });

  it('409: order not in pending status', async () => {
    const customer = await seedUser({ username: 'cust_confstatus' });
    const associate = await seedUser({ username: 'assoc_confstatus', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'confirmed' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/confirm`,
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/only be confirmed from 'pending'/i);
  });

  it('422: no tender splits recorded', async () => {
    const customer = await seedUser({ username: 'cust_nosplit' });
    const associate = await seedUser({ username: 'assoc_nosplit', role: 'associate' });
    const product = await seedProduct({ price: '10.00' });
    const order = await seedOrder({ customerId: customer.id });
    await seedOrderItem({ orderId: order.id, productId: product.id, qty: 1, unitPrice: '10.00' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/confirm`,
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/no tender splits/i);
  });

  it('422: tender total does not match order total', async () => {
    const customer = await seedUser({ username: 'cust_mismatch' });
    const associate = await seedUser({ username: 'assoc_mismatch', role: 'associate' });
    const product = await seedProduct({ price: '19.99' });
    const order = await seedOrder({ customerId: customer.id });
    await seedOrderItem({ orderId: order.id, productId: product.id, qty: 2, unitPrice: '19.99' });
    // Order total = $39.98; tender = $10.00 (mismatch)
    await seedTenderSplit({ orderId: order.id, method: 'cash', amount: '10.00' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/confirm`,
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/does not match order total/i);
  });

  it('200: matching totals → status becomes "confirmed" and audit log written', async () => {
    const customer = await seedUser({ username: 'cust_match' });
    const associate = await seedUser({ username: 'assoc_match', role: 'associate' });
    const product = await seedProduct({ price: '9.99' });
    const order = await seedOrder({ customerId: customer.id });
    await seedOrderItem({ orderId: order.id, productId: product.id, qty: 2, unitPrice: '9.99' });
    // Order total = $19.98
    await seedTenderSplit({ orderId: order.id, method: 'cash', amount: '19.98' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/confirm`,
      headers: authHeader(auth),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('confirmed');
    expect(body.orderTotalCents).toBe(1998);
    expect(body.tenderTotalCents).toBe(1998);

    // DB status check
    const [dbOrder] = await testDb
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(dbOrder!.status).toBe('confirmed');

    // Audit log
    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, order.id));
    expect(logs.some((l) => l.action === 'order.confirmed')).toBe(true);
  });

  it('200: split tender (cash + card) that totals correctly', async () => {
    const customer = await seedUser({ username: 'cust_split' });
    const associate = await seedUser({ username: 'assoc_split', role: 'associate' });
    const product = await seedProduct({ price: '30.00' });
    const order = await seedOrder({ customerId: customer.id });
    await seedOrderItem({ orderId: order.id, productId: product.id, qty: 1, unitPrice: '30.00' });
    // Split: $20 cash + $10 card
    await seedTenderSplit({ orderId: order.id, method: 'cash', amount: '20.00' });
    await seedTenderSplit({ orderId: order.id, method: 'card', amount: '10.00', reference: 'TXN-SPLIT' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/confirm`,
      headers: authHeader(auth),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');
  });
});

// ── POST /orders/:id/pickup/verify ────────────────────────────────────────────

describe('POST /orders/:id/pickup/verify', () => {
  it('401: requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/pickup/verify',
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403: customer role cannot verify pickup', async () => {
    const customer = await seedUser({ username: 'cust_pv403' });
    const { order } = await seedOrderWithCode({ customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404: order not found', async () => {
    const associate = await seedUser({ username: 'assoc_pv404', role: 'associate' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/pickup/verify',
      headers: authHeader(auth),
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409: order not in ready_for_pickup status', async () => {
    const customer = await seedUser({ username: 'cust_pvwrongstatus' });
    const associate = await seedUser({ username: 'assoc_pvwrongstatus', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'pending' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/ready_for_pickup/i);
  });

  it('400: code must be exactly 6 digits', async () => {
    const customer = await seedUser({ username: 'cust_pvbadcode' });
    const associate = await seedUser({ username: 'assoc_pvbadcode', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: '12345' }, // 5 digits — invalid
    });
    expect(res.statusCode).toBe(400);
  });

  it('200: correct code → verified=true, order status → picked_up', async () => {
    const customer = await seedUser({ username: 'cust_pvcorrect' });
    const associate = await seedUser({ username: 'assoc_pvcorrect', role: 'associate' });
    const { order, pickupCodePlain } = await seedOrderWithCode({ customerId: customer.id });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: pickupCodePlain },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().verified).toBe(true);

    const [dbOrder] = await testDb
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(dbOrder!.status).toBe('picked_up');
  });

  it('200: correct code → audit log pickup.verified written', async () => {
    const customer = await seedUser({ username: 'cust_pvaudit' });
    const associate = await seedUser({ username: 'assoc_pvaudit', role: 'associate' });
    const { order, pickupCodePlain } = await seedOrderWithCode({ customerId: customer.id });
    const auth = await loginAs(app, associate.username);

    await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: pickupCodePlain },
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, order.id));
    expect(logs.some((l) => l.action === 'pickup.verified')).toBe(true);
  });

  it('200: wrong code → verified=false, pickupAttempts incremented', async () => {
    const customer = await seedUser({ username: 'cust_pvwrong' });
    const associate = await seedUser({ username: 'assoc_pvwrong', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: '000000' }, // wrong code
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().verified).toBe(false);

    const [dbOrder] = await testDb
      .select({ pickupAttempts: orders.pickupAttempts, status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(dbOrder!.pickupAttempts).toBe(1);
    expect(dbOrder!.status).toBe('ready_for_pickup');
  });

  it('200: 5th wrong code → status becomes pickup_locked', async () => {
    const customer = await seedUser({ username: 'cust_pvlock' });
    const associate = await seedUser({ username: 'assoc_pvlock', role: 'associate' });
    // Start with 4 failed attempts already
    const { order } = await seedOrderWithCode({ customerId: customer.id, pickupAttempts: 4 });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: '000000' }, // wrong code — 5th attempt
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().verified).toBe(false);

    const [dbOrder] = await testDb
      .select({ pickupAttempts: orders.pickupAttempts, status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(dbOrder!.pickupAttempts).toBe(5);
    expect(dbOrder!.status).toBe('pickup_locked');
  });

  it('423: already locked order', async () => {
    const customer = await seedUser({ username: 'cust_pvalready' });
    const associate = await seedUser({ username: 'assoc_pvalready', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id, status: 'pickup_locked' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/verify`,
      headers: authHeader(auth),
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().error).toMatch(/locked/i);
  });
});

// ── POST /orders/:id/pickup/manager-override ───────────────────────────────────

describe('POST /orders/:id/pickup/manager-override', () => {
  const MANAGER_PASSWORD = 'manager_password1234';

  it('401: requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/pickup/manager-override',
      payload: { managerUsername: 'mgr', managerPassword: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('404: order not found', async () => {
    const associate = await seedUser({ username: 'assoc_mo404', role: 'associate' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: '/orders/00000000-0000-0000-0000-000000000001/pickup/manager-override',
      headers: authHeader(auth),
      payload: { managerUsername: 'mgr', managerPassword: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409: order is not in pickup_locked status', async () => {
    const customer = await seedUser({ username: 'cust_mowrong' });
    const associate = await seedUser({ username: 'assoc_mowrong', role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'ready_for_pickup' });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/manager-override`,
      headers: authHeader(auth),
      payload: { managerUsername: 'mgr', managerPassword: 'x' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/pickup_locked/i);
  });

  it('401: wrong manager password', async () => {
    const customer = await seedUser({ username: 'cust_mowrongpw' });
    const manager = await seedUser({ username: 'mgr_wrongpw', role: 'manager', password: MANAGER_PASSWORD });
    const associate = await seedUser({ username: 'assoc_mowrongpw', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id, status: 'pickup_locked' });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/manager-override`,
      headers: authHeader(assocAuth),
      payload: { managerUsername: manager.username, managerPassword: 'wrong_password_here' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid manager credentials/i);
  });

  it('403: supplied credentials belong to associate (not manager)', async () => {
    const customer = await seedUser({ username: 'cust_moassoc' });
    const associate = await seedUser({ username: 'assoc_override', role: 'associate', password: MANAGER_PASSWORD });
    const actor = await seedUser({ username: 'actor_assoc', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id, status: 'pickup_locked' });
    const actorAuth = await loginAs(app, actor.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/manager-override`,
      headers: authHeader(actorAuth),
      payload: { managerUsername: associate.username, managerPassword: MANAGER_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/manager or admin/i);
  });

  it('423: manager account is locked', async () => {
    const customer = await seedUser({ username: 'cust_molocked' });
    const manager = await seedUser({
      username: 'mgr_locked',
      role: 'manager',
      password: MANAGER_PASSWORD,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000), // locked for 15 min
    });
    const associate = await seedUser({ username: 'assoc_molocked', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id, status: 'pickup_locked' });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/manager-override`,
      headers: authHeader(assocAuth),
      payload: { managerUsername: manager.username, managerPassword: MANAGER_PASSWORD },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().error).toMatch(/locked/i);
  });

  it('200: valid manager credentials → order picked_up, audit log written', async () => {
    const customer = await seedUser({ username: 'cust_mopass' });
    const manager = await seedUser({ username: 'mgr_pass', role: 'manager', password: MANAGER_PASSWORD });
    const associate = await seedUser({ username: 'assoc_mopass', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id, status: 'pickup_locked' });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/manager-override`,
      headers: authHeader(assocAuth),
      payload: { managerUsername: manager.username, managerPassword: MANAGER_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().overridden).toBe(true);

    // Order status → picked_up
    const [dbOrder] = await testDb
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(dbOrder!.status).toBe('picked_up');

    // Audit log: pickup.manager_override, actorId = manager.id
    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, order.id));
    const overrideLog = logs.find((l) => l.action === 'pickup.manager_override');
    expect(overrideLog).toBeDefined();
    expect(overrideLog!.actorId).toBe(manager.id);
  });

  it('200: admin credentials also work for override', async () => {
    const customer = await seedUser({ username: 'cust_moadmin' });
    const admin = await seedUser({ username: 'admin_override', role: 'admin', password: MANAGER_PASSWORD });
    const associate = await seedUser({ username: 'assoc_moadmin', role: 'associate' });
    const { order } = await seedOrderWithCode({ customerId: customer.id, status: 'pickup_locked' });
    const assocAuth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/pickup/manager-override`,
      headers: authHeader(assocAuth),
      payload: { managerUsername: admin.username, managerPassword: MANAGER_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().overridden).toBe(true);
  });
});
