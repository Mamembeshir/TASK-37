/**
 * Integration tests for moderation routes:
 *   POST /moderation/flags/:id/report
 *   GET  /moderation/appeals
 *   PUT  /moderation/appeals/:id/resolve
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { buildModerationTestApp } from '../test/app.js';
import { inject } from '../test/client.js';
import {
  seedUser,
  seedOrder,
  seedReview,
  seedReviewImage,
  seedModerationFlag,
  seedModerationAppeal,
  seedImageHash,
} from '../test/helpers.js';
import { moderationFlags, moderationAppeals } from '../db/schema/moderation.js';
import { reviews } from '../db/schema/reviews.js';
import { imageHashes } from '../db/schema/image-hashes.js';
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
  ({ app, url } = await buildModerationTestApp());
});

afterAll(async () => {
  await app.close();
  await clearAllTables();
  await closeDb();
});

// ── POST /moderation/flags/:id/report ─────────────────────────────────────────

describe('POST /moderation/flags/:id/report', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, {
      method: 'POST',
      url: '/moderation/flags/00000000-0000-0000-0000-000000000001/report',
      payload: { entityType: 'review', reason: 'Inappropriate' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when body is invalid (missing entityType)', async () => {
    const user = await seedUser({ role: 'customer' });
    const auth = await loginAs(user.username);

    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id });

    const res = await inject(url, {
      method: 'POST',
      url: `/moderation/flags/${review.id}/report`,
      headers: { authorization: auth },
      payload: { reason: 'Inappropriate' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a user_report flag (201)', async () => {
    const reporter = await seedUser({ role: 'customer' });
    const owner = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: owner.id });
    const auth = await loginAs(reporter.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/moderation/flags/${review.id}/report`,
      headers: { authorization: auth },
      payload: { entityType: 'review', reason: 'Contains offensive language.' },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.entityType).toBe('review');
    expect(json.entityId).toBe(review.id);
    expect(json.source).toBe('user_report');
    expect(json.reportedBy).toBe(reporter.id);
    expect(json.status).toBe('pending');
  });

  it('returns 409 when same user reports same entity twice in one day', async () => {
    const reporter = await seedUser({ role: 'customer' });
    const owner = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: owner.id });
    const auth = await loginAs(reporter.username);

    // First report
    await inject(url, {
      method: 'POST',
      url: `/moderation/flags/${review.id}/report`,
      headers: { authorization: auth },
      payload: { entityType: 'review', reason: 'First report' },
    });

    // Duplicate report on same entity same day
    const res = await inject(url, {
      method: 'POST',
      url: `/moderation/flags/${review.id}/report`,
      headers: { authorization: auth },
      payload: { entityType: 'review', reason: 'Second report' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already reported/i);
  });

  it('returns 429 when user exceeds 5 reports per day', async () => {
    const reporter = await seedUser({ role: 'customer' });
    const auth = await loginAs(reporter.username);

    // Seed 5 existing user_report flags for today to hit the limit
    for (let i = 0; i < 5; i++) {
      const owner = await seedUser({ role: 'customer' });
      const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
      const review = await seedReview({ orderId: order.id, customerId: owner.id });
      await seedModerationFlag({
        entityType: 'review',
        entityId: review.id,
        source: 'user_report',
        reportedBy: reporter.id,
      });
    }

    // 6th report should be throttled
    const owner = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: owner.id });

    const res = await inject(url, {
      method: 'POST',
      url: `/moderation/flags/${review.id}/report`,
      headers: { authorization: auth },
      payload: { entityType: 'review', reason: 'Over the limit' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/limit|maximum/i);
  });

  it('can report a review_image entity type', async () => {
    const reporter = await seedUser({ role: 'customer' });
    const owner = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: owner.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: owner.id });
    const img = await seedReviewImage({ reviewId: review.id });
    const auth = await loginAs(reporter.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/moderation/flags/${img.id}/report`,
      headers: { authorization: auth },
      payload: { entityType: 'review_image', reason: 'Inappropriate image.' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entityType).toBe('review_image');
    expect(res.json().entityId).toBe(img.id);
  });
});

// ── GET /moderation/appeals ───────────────────────────────────────────────────

describe('GET /moderation/appeals', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/moderation/appeals' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when authenticated as customer', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/moderation/appeals',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns empty array when no pending appeals', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/moderation/appeals',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns pending appeals with embedded flag for associate', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id });
    const flag = await seedModerationFlag({ entityType: 'review', entityId: review.id });
    await seedModerationAppeal({ flagId: flag.id, submittedBy: customer.id, reason: 'I disagree' });

    const auth = await loginAs(associate.username);
    const res = await inject(url, {
      method: 'GET',
      url: '/moderation/appeals',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const appeals = res.json();
    expect(appeals.length).toBeGreaterThanOrEqual(1);
    const appeal = appeals.find((a: any) => a.flagId === flag.id);
    expect(appeal).toBeDefined();
    expect(appeal.flag.entityId).toBe(review.id);
    expect(appeal.flag.entityType).toBe('review');
    expect(appeal.status).toBe('pending');
  });

  it('does not return already-resolved appeals', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id });
    const flag = await seedModerationFlag({
      entityType: 'review',
      entityId: review.id,
      status: 'resolved_approved',
    });
    const appeal = await seedModerationAppeal({
      flagId: flag.id,
      submittedBy: customer.id,
      status: 'approved',
    });

    const auth = await loginAs(associate.username);
    const res = await inject(url, {
      method: 'GET',
      url: '/moderation/appeals',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((a: any) => a.id);
    expect(ids).not.toContain(appeal.id);
  });

  it('supervisor can also access the appeals queue', async () => {
    const supervisor = await seedUser({ role: 'supervisor' });
    const auth = await loginAs(supervisor.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/moderation/appeals',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── PUT /moderation/appeals/:id/resolve ───────────────────────────────────────

describe('PUT /moderation/appeals/:id/resolve', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, {
      method: 'PUT',
      url: '/moderation/appeals/00000000-0000-0000-0000-000000000001/resolve',
      payload: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when authenticated as customer', async () => {
    const customer = await seedUser({ role: 'customer' });
    const auth = await loginAs(customer.username);

    const res = await inject(url, {
      method: 'PUT',
      url: '/moderation/appeals/00000000-0000-0000-0000-000000000002/resolve',
      headers: { authorization: auth },
      payload: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when appeal does not exist', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: '/moderation/appeals/00000000-0000-0000-0000-000000000003/resolve',
      headers: { authorization: auth },
      payload: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when appeal is already resolved', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id });
    const flag = await seedModerationFlag({
      entityType: 'review',
      entityId: review.id,
      status: 'resolved_approved',
    });
    const appeal = await seedModerationAppeal({
      flagId: flag.id,
      submittedBy: customer.id,
      status: 'approved',
    });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/moderation/appeals/${appeal.id}/resolve`,
      headers: { authorization: auth },
      payload: { decision: 'rejected' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already been resolved/i);
  });

  it('approved decision sets appeal=approved, flag=resolved_approved, review.moderationStatus=approved', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id, moderationStatus: 'flagged' });
    const flag = await seedModerationFlag({ entityType: 'review', entityId: review.id });
    const appeal = await seedModerationAppeal({ flagId: flag.id, submittedBy: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/moderation/appeals/${appeal.id}/resolve`,
      headers: { authorization: auth },
      payload: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('approved');
    expect(json.reviewedBy).toBe(associate.id);
    expect(json.flag.status).toBe('resolved_approved');

    // Verify review is now approved in DB
    const [updatedReview] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updatedReview!.moderationStatus).toBe('approved');
  });

  it('rejected decision sets appeal=rejected, flag=resolved_rejected', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id, moderationStatus: 'flagged' });
    const flag = await seedModerationFlag({ entityType: 'review', entityId: review.id });
    const appeal = await seedModerationAppeal({ flagId: flag.id, submittedBy: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/moderation/appeals/${appeal.id}/resolve`,
      headers: { authorization: auth },
      payload: { decision: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('rejected');
    expect(res.json().flag.status).toBe('resolved_rejected');

    // Verify in DB
    const [updatedFlag] = await testDb
      .select()
      .from(moderationFlags)
      .where(eq(moderationFlags.id, flag.id));
    expect(updatedFlag!.status).toBe('resolved_rejected');
    expect(updatedFlag!.resolvedBy).toBe(associate.id);
  });

  it('rejected review_image appeal adds image SHA-256 to blocklist', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id });
    const sha256 = 'a'.repeat(64); // fake unique SHA-256
    const img = await seedReviewImage({ reviewId: review.id, sha256 });
    const flag = await seedModerationFlag({ entityType: 'review_image', entityId: img.id });
    const appeal = await seedModerationAppeal({ flagId: flag.id, submittedBy: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/moderation/appeals/${appeal.id}/resolve`,
      headers: { authorization: auth },
      payload: { decision: 'rejected' },
    });
    expect(res.statusCode).toBe(200);

    // SHA-256 must now be in the image_hashes blocklist
    const [blocked] = await testDb
      .select()
      .from(imageHashes)
      .where(eq(imageHashes.sha256, sha256));
    expect(blocked).toBeDefined();
    expect(blocked!.flaggedBy).toBe(associate.id);
  });

  it('approved review_image appeal does NOT add SHA-256 to blocklist', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id });
    const sha256 = 'b'.repeat(64);
    const img = await seedReviewImage({ reviewId: review.id, sha256 });
    const flag = await seedModerationFlag({ entityType: 'review_image', entityId: img.id });
    const appeal = await seedModerationAppeal({ flagId: flag.id, submittedBy: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/moderation/appeals/${appeal.id}/resolve`,
      headers: { authorization: auth },
      payload: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(200);

    const [blocked] = await testDb
      .select()
      .from(imageHashes)
      .where(eq(imageHashes.sha256, sha256));
    expect(blocked).toBeUndefined();
  });

  it('response includes embedded flag with updated status', async () => {
    const associate = await seedUser({ role: 'associate' });
    const customer = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: customer.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: customer.id, moderationStatus: 'flagged' });
    const flag = await seedModerationFlag({ entityType: 'review', entityId: review.id });
    const appeal = await seedModerationAppeal({ flagId: flag.id, submittedBy: customer.id });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/moderation/appeals/${appeal.id}/resolve`,
      headers: { authorization: auth },
      payload: { decision: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.flag).toBeDefined();
    expect(json.flag.id).toBe(flag.id);
    expect(json.flag.entityType).toBe('review');
    expect(json.reviewedAt).not.toBeNull();
  });
});
