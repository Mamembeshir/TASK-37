/**
 * Integration tests for POST /reviews, POST /reviews/:id/followup, GET /reviews.
 *
 * Multipart bodies are built manually (buildMultipart helper) and sent via
 * app.inject(), which does NOT go through the OS network stack.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import {
  buildReviewTestApp,
} from '../test/app.js';
import {
  seedUser,
  seedProduct,
  seedOrder,
  seedReview,
  seedBannedTerm,
  seedImageHash,
  buildMultipart,
  VALID_JPEG_BUFFER,
  VALID_PNG_BUFFER,
} from '../test/helpers.js';
import { reviews } from '../db/schema/reviews.js';
import type { FastifyInstance } from 'fastify';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(app: FastifyInstance, username: string, password = 'password1234'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  const token = res.json().token as string;
  return `Bearer ${token}`;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  await runMigrations();
  app = await buildReviewTestApp();
});

afterAll(async () => {
  await app.close();
  await clearAllTables();
  await closeDb();
});

// ── POST /reviews ─────────────────────────────────────────────────────────────

describe('POST /reviews', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/reviews' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when body field is missing', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });

    const { body, contentType } = buildMultipart({
      fields: { orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/body/i);
  });

  it('returns 400 when orderId is missing', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Great product!' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/orderId/i);
  });

  it('returns 404 when order does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);
    const fakeOrderId = '00000000-0000-0000-0000-000000000001';

    const { body, contentType } = buildMultipart({
      fields: { body: 'Great!', orderId: fakeOrderId },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when customer reviews another customer\'s order', async () => {
    const owner = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const auth = await loginAs(app, other.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Great!', orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when order is not picked_up', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'confirmed' });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Great!', orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/picked.up/i);
  });

  it('returns 409 when review already exists for order', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    await seedReview({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Another review', orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already exists/i);
  });

  it('creates review successfully (201) with correct shape', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Excellent purchase!', orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.orderId).toBe(order.id);
    expect(json.customerId).toBe(customer.id);
    expect(json.body).toBe('Excellent purchase!');
    expect(json.isFollowup).toBe(false);
    expect(json.moderationStatus).toBe('pending'); // pre-scan status
    expect(Array.isArray(json.images)).toBe(true);
    expect(json.images).toHaveLength(0);
  });

  it('creates review with a valid JPEG image attachment', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Great product, see photo!', orderId: order.id },
      files: [
        { fieldname: 'images', filename: 'photo.jpg', mimetype: 'image/jpeg', buffer: VALID_JPEG_BUFFER },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.images).toHaveLength(1);
    expect(json.images[0].mimeType).toBe('image/jpeg');
    expect(json.images[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns 400 when image has unsupported MIME type', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'Review with gif', orderId: order.id },
      files: [
        { fieldname: 'images', filename: 'anim.gif', mimetype: 'image/gif', buffer: Buffer.from('GIF89a') },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/jpeg.*png|png.*jpeg/i);
  });

  it('returns 400 when JPEG content-type has wrong magic bytes', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    // Send PNG bytes but claim image/jpeg
    const { body, contentType } = buildMultipart({
      fields: { body: 'Spoofed content type', orderId: order.id },
      files: [
        { fieldname: 'images', filename: 'fake.jpg', mimetype: 'image/jpeg', buffer: VALID_PNG_BUFFER },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/magic bytes|does not match/i);
  });

  it('returns 400 when image SHA-256 is in the blocklist', async () => {
    const staff = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    const sha256 = createHash('sha256').update(VALID_JPEG_BUFFER).digest('hex');
    await seedImageHash({ sha256, flaggedBy: staff.id });

    const { body, contentType } = buildMultipart({
      fields: { body: 'Review with blocked image', orderId: order.id },
      files: [
        { fieldname: 'images', filename: 'blocked.jpg', mimetype: 'image/jpeg', buffer: VALID_JPEG_BUFFER },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/flagged/i);
  });

  it('review moderationStatus becomes flagged after scan when body matches banned term', async () => {
    const admin = await seedUser({ role: 'admin' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    await seedBannedTerm({ term: 'badphrase', isActive: true, createdBy: admin.id });

    const { body, contentType } = buildMultipart({
      fields: { body: 'This product has badphrase issues!', orderId: order.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    // Response always shows pre-scan status (pending)
    expect(res.statusCode).toBe(201);
    expect(res.json().moderationStatus).toBe('pending');

    // But DB should now show flagged (scan ran synchronously)
    const [dbReview] = await testDb
      .select()
      .from(reviews)
      .where(eq(reviews.id, res.json().id));
    expect(dbReview!.moderationStatus).toBe('flagged');
  });
});

// ── POST /reviews/:id/followup ────────────────────────────────────────────────

describe('POST /reviews/:id/followup', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/reviews/00000000-0000-0000-0000-000000000001/followup' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when parent review does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);
    const fakeId = '00000000-0000-0000-0000-000000000002';

    const { body, contentType } = buildMultipart({ fields: { body: 'Follow up text' } });

    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${fakeId}/followup`,
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when customer follows up on another customer\'s review', async () => {
    const owner = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: owner.id });
    const auth = await loginAs(app, other.username);

    const { body, contentType } = buildMultipart({ fields: { body: 'Unauthorized follow up' } });

    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${review.id}/followup`,
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when trying to follow up on a follow-up', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const original = await seedReview({ orderId: order.id, customerId: customer.id });
    const followup = await seedReview({
      orderId: order.id,
      customerId: customer.id,
      isFollowup: true,
      parentReviewId: original.id,
    });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({ fields: { body: 'Second follow up attempt' } });

    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${followup.id}/followup`,
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/follow.up on a follow.up/i);
  });

  it('returns 409 when a follow-up already exists', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const original = await seedReview({ orderId: order.id, customerId: customer.id });
    // Pre-seed an existing follow-up
    await seedReview({
      orderId: order.id,
      customerId: customer.id,
      isFollowup: true,
      parentReviewId: original.id,
    });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({ fields: { body: 'Duplicate follow up' } });

    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${original.id}/followup`,
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already been submitted/i);
  });

  it('creates a follow-up review successfully (201)', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const original = await seedReview({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, customer.username);

    const { body, contentType } = buildMultipart({
      fields: { body: 'I have an update on this product.' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/reviews/${original.id}/followup`,
      headers: { authorization: auth, 'content-type': contentType },
      body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.isFollowup).toBe(true);
    expect(json.parentReviewId).toBe(original.id);
    expect(json.orderId).toBe(order.id);
  });
});

// ── GET /reviews ──────────────────────────────────────────────────────────────

describe('GET /reviews', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reviews?orderId=00000000-0000-0000-0000-000000000001',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when orderId query param is missing', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);
    const res = await app.inject({
      method: 'GET',
      url: '/reviews',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when order does not exist', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(app, customer.username);
    const res = await app.inject({
      method: 'GET',
      url: '/reviews?orderId=00000000-0000-0000-0000-000000000003',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when customer queries another customer\'s order', async () => {
    const owner = await seedUser({ role: 'customer' });
    const other = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const auth = await loginAs(app, other.username);

    const res = await app.inject({
      method: 'GET',
      url: `/reviews?orderId=${order.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns empty array when order has no reviews', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'GET',
      url: `/reviews?orderId=${order.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns reviews with images for customer\'s own order', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    await seedReview({ orderId: order.id, customerId: customer.id, body: 'My review' });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'GET',
      url: `/reviews?orderId=${order.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveLength(1);
    expect(json[0].body).toBe('My review');
    expect(Array.isArray(json[0].images)).toBe(true);
  });

  it('staff can view reviews for any order', async () => {
    const customer = await seedUser({ role: 'customer' });
    const associate = await seedUser({ role: 'associate' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    await seedReview({ orderId: order.id, customerId: customer.id });
    const auth = await loginAs(app, associate.username);

    const res = await app.inject({
      method: 'GET',
      url: `/reviews?orderId=${order.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('returns original and follow-up reviews for an order', async () => {
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const original = await seedReview({ orderId: order.id, customerId: customer.id });
    await seedReview({
      orderId: order.id,
      customerId: customer.id,
      isFollowup: true,
      parentReviewId: original.id,
    });
    const auth = await loginAs(app, customer.username);

    const res = await app.inject({
      method: 'GET',
      url: `/reviews?orderId=${order.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    const followupInResponse = res.json().find((r: any) => r.isFollowup === true);
    expect(followupInResponse).toBeDefined();
    expect(followupInResponse.parentReviewId).toBe(original.id);
  });
});
