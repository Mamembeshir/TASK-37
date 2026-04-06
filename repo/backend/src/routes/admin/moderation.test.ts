/**
 * Integration tests for admin moderation queue:
 *   GET  /admin/moderation
 *   POST /admin/moderation/:id/approve
 *   POST /admin/moderation/:id/reject
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, runMigrations, clearAllTables, closeDb } from '../../test/db.js';
import { buildAdminModerationTestApp } from '../../test/app.js';
import { inject } from '../../test/client.js';
import {
  seedUser,
  seedOrder,
  seedReview,
  seedModerationFlag,
} from '../../test/helpers.js';
import { reviews } from '../../db/schema/reviews.js';
import { moderationFlags } from '../../db/schema/moderation.js';
import { auditLogs } from '../../db/schema/audit-logs.js';
import type { FastifyInstance } from 'fastify';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(username: string, password = 'password1234'): Promise<string> {
  const res = await inject(url, {
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  return `Bearer ${res.json<{ token: string }>().token}`;
}

/** Seed the minimal chain needed to get a review: customer → order → review. */
async function seedReviewChain(opts: {
  moderationStatus?: 'pending' | 'approved' | 'flagged';
  withFlag?: boolean;
} = {}) {
  const { moderationStatus = 'pending', withFlag = false } = opts;
  const customer = await seedUser({ role: 'customer' });
  const order    = await seedOrder({ customerId: customer.id });
  const review   = await seedReview({ orderId: order.id, customerId: customer.id, moderationStatus });
  const flag     = withFlag
    ? await seedModerationFlag({ entityType: 'review', entityId: review.id })
    : null;
  return { customer, order, review, flag };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  await runMigrations();
  ({ app, url } = await buildAdminModerationTestApp());
});

beforeEach(async () => {
  await clearAllTables();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ── GET /admin/moderation ─────────────────────────────────────────────────────

describe('GET /admin/moderation', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/admin/moderation' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for customer and associate roles', async () => {
    for (const role of ['customer', 'associate'] as const) {
      const user = await seedUser({ role });
      const auth = await loginAs(user.username);
      const res = await inject(url, {
        method: 'GET',
        url: '/admin/moderation',
        headers: { authorization: auth },
      });
      expect(res.statusCode, `expected 403 for role ${role}`).toBe(403);
    }
  });

  it('returns 200 for supervisor, manager, and admin', async () => {
    for (const role of ['supervisor', 'manager', 'admin'] as const) {
      const user = await seedUser({ role });
      const auth = await loginAs(user.username);
      const res = await inject(url, {
        method: 'GET',
        url: '/admin/moderation',
        headers: { authorization: auth },
      });
      expect(res.statusCode, `expected 200 for role ${role}`).toBe(200);
    }
  });

  it('returns an array with correct ModerationItem shape', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedReviewChain({ moderationStatus: 'pending' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/moderation',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json<Record<string, unknown>[]>();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const item = data[0]!;
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('orderId');
    expect(item).toHaveProperty('customerId');
    expect(item).toHaveProperty('body');
    expect(item).toHaveProperty('isFollowup');
    expect(item).toHaveProperty('moderationStatus');
    expect(item).toHaveProperty('flagReason');
    expect(item).toHaveProperty('submittedAt');
    expect(item).toHaveProperty('resolvedAt');
    expect(item).toHaveProperty('resolvedByUsername');
    expect(item).toHaveProperty('resolvedNote');
    expect(item).toHaveProperty('imageCount');
  });

  it('includes flagReason when a flag exists', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'flagged' });
    await seedModerationFlag({
      entityType: 'review',
      entityId: review.id,
      reason: 'contains banned term',
    });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/moderation',
      headers: { authorization: auth },
    });
    const data = res.json<{ id: string; flagReason: string | null }[]>();
    const row = data.find((i) => i.id === review.id);
    expect(row).toBeDefined();
    expect(row!.flagReason).toBe('contains banned term');
  });

  it('returns flagReason: null for reviews with no flag', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'pending', withFlag: false });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/moderation',
      headers: { authorization: auth },
    });
    const data = res.json<{ id: string; flagReason: string | null }[]>();
    const row = data.find((i) => i.id === review.id);
    expect(row).toBeDefined();
    expect(row!.flagReason).toBeNull();
  });

  it('returns imageCount: 0 when review has no images', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain();
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/moderation',
      headers: { authorization: auth },
    });
    const data = res.json<{ id: string; imageCount: number }[]>();
    const row = data.find((i) => i.id === review.id);
    expect(row!.imageCount).toBe(0);
  });
});

// ── POST /admin/moderation/:id/approve ───────────────────────────────────────

describe('POST /admin/moderation/:id/approve', () => {
  it('returns 401 when not authenticated', async () => {
    const { review } = await seedReviewChain();
    const res = await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/approve`,
      payload: { note: null },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for customer and associate', async () => {
    for (const role of ['customer', 'associate'] as const) {
      const { review } = await seedReviewChain();
      const user = await seedUser({ role });
      const auth = await loginAs(user.username);
      const res = await inject(url, {
        method: 'POST',
        url: `/admin/moderation/${review.id}/approve`,
        headers: { authorization: auth },
        payload: { note: null },
      });
      expect(res.statusCode, `expected 403 for role ${role}`).toBe(403);
    }
  });

  it('returns 404 for non-existent review', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/moderation/00000000-0000-0000-0000-000000000000/approve',
      headers: { authorization: auth },
      payload: { note: null },
    });
    expect(res.statusCode).toBe(404);
  });

  it('sets moderationStatus to approved and returns updated item', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'flagged', withFlag: true });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/approve`,
      headers: { authorization: auth },
      payload: { note: 'Reviewed and cleared' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; moderationStatus: string }>();
    expect(body.id).toBe(review.id);
    expect(body.moderationStatus).toBe('approved');
  });

  it('resolves pending flags as resolved_approved', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review, flag } = await seedReviewChain({ moderationStatus: 'flagged', withFlag: true });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/approve`,
      headers: { authorization: auth },
      payload: { note: null },
    });

    const [updatedFlag] = await testDb
      .select()
      .from(moderationFlags)
      .where(eq(moderationFlags.id, flag!.id));
    expect(updatedFlag!.status).toBe('resolved_approved');
    expect(updatedFlag!.resolvedBy).toBe(admin.id);
  });

  it('writes an audit log entry for approve', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'pending' });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/approve`,
      headers: { authorization: auth },
      payload: { note: 'looks good' },
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, review.id));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.action === 'moderation.review_approved')).toBe(true);
  });

  it('works for supervisor role too', async () => {
    const supervisor = await seedUser({ role: 'supervisor' });
    const { review } = await seedReviewChain({ moderationStatus: 'pending' });
    const auth = await loginAs(supervisor.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/approve`,
      headers: { authorization: auth },
      payload: { note: null },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── POST /admin/moderation/:id/reject ────────────────────────────────────────

describe('POST /admin/moderation/:id/reject', () => {
  it('returns 401 when not authenticated', async () => {
    const { review } = await seedReviewChain();
    const res = await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/reject`,
      payload: { note: 'spam' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for customer and associate', async () => {
    for (const role of ['customer', 'associate'] as const) {
      const { review } = await seedReviewChain();
      const user = await seedUser({ role });
      const auth = await loginAs(user.username);
      const res = await inject(url, {
        method: 'POST',
        url: `/admin/moderation/${review.id}/reject`,
        headers: { authorization: auth },
        payload: { note: 'spam' },
      });
      expect(res.statusCode, `expected 403 for role ${role}`).toBe(403);
    }
  });

  it('returns 404 for non-existent review', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/moderation/00000000-0000-0000-0000-000000000000/reject',
      headers: { authorization: auth },
      payload: { note: 'spam' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('sets moderationStatus to flagged and returns updated item', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'pending', withFlag: true });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/reject`,
      headers: { authorization: auth },
      payload: { note: 'violates policy' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; moderationStatus: string }>();
    expect(body.id).toBe(review.id);
    expect(body.moderationStatus).toBe('flagged');
  });

  it('resolves pending flags as resolved_rejected', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review, flag } = await seedReviewChain({ moderationStatus: 'pending', withFlag: true });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/reject`,
      headers: { authorization: auth },
      payload: { note: 'violates policy' },
    });

    const [updatedFlag] = await testDb
      .select()
      .from(moderationFlags)
      .where(eq(moderationFlags.id, flag!.id));
    expect(updatedFlag!.status).toBe('resolved_rejected');
    expect(updatedFlag!.resolvedBy).toBe(admin.id);
  });

  it('persists the updated review status in the database', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'pending' });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/reject`,
      headers: { authorization: auth },
      payload: { note: 'spam' },
    });

    const [dbReview] = await testDb
      .select()
      .from(reviews)
      .where(eq(reviews.id, review.id));
    expect(dbReview!.moderationStatus).toBe('flagged');
  });

  it('writes an audit log entry for reject', async () => {
    const admin = await seedUser({ role: 'admin' });
    const { review } = await seedReviewChain({ moderationStatus: 'pending' });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/moderation/${review.id}/reject`,
      headers: { authorization: auth },
      payload: { note: 'spam content' },
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, review.id));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.action === 'moderation.review_rejected')).toBe(true);
  });
});
