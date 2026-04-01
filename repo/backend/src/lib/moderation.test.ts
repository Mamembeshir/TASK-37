/**
 * Unit + integration tests for lib/moderation.ts — runModerationScan.
 *
 * runModerationScan is called with real DB (it reads banned_terms and writes
 * moderation_flags / audit_logs), so the test DB lifecycle is required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { runModerationScan } from './moderation.js';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { seedUser, seedProduct, seedOrder, seedBannedTerm, seedReview, seedReviewImage } from '../test/helpers.js';
import { reviews } from '../db/schema/reviews.js';
import { moderationFlags } from '../db/schema/moderation.js';
import { auditLogs } from '../db/schema/audit-logs.js';

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await clearAllTables();
  await closeDb();
});

// ── runModerationScan ─────────────────────────────────────────────────────────

describe('runModerationScan', () => {
  it('leaves review as pending when no banned terms exist', async () => {
    const user = await seedUser({ role: 'customer' });
    const product = await seedProduct();
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Nice item!' });

    await runModerationScan(testDb as any, review.id, review.body, []);

    const [updated] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updated!.moderationStatus).toBe('pending');
  });

  it('leaves review as pending when body has no match against active terms', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Excellent quality!' });

    // Term that does NOT appear in the body
    await seedBannedTerm({ term: 'badword', isActive: true, createdBy: admin.id });

    await runModerationScan(testDb as any, review.id, review.body, []);

    const [updated] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updated!.moderationStatus).toBe('pending');
  });

  it('flags review when body contains an exact banned term (case-insensitive)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'This is SPAM content!' });

    await seedBannedTerm({ term: 'spam', isActive: true, createdBy: admin.id });

    await runModerationScan(testDb as any, review.id, review.body, []);

    const [updated] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updated!.moderationStatus).toBe('flagged');
  });

  it('inserts one moderation_flag for the review body on match', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Contains offensive content here.' });

    await seedBannedTerm({ term: 'offensive', isActive: true, createdBy: admin.id });

    await runModerationScan(testDb as any, review.id, review.body, []);

    const flags = await testDb
      .select()
      .from(moderationFlags)
      .where(eq(moderationFlags.entityId, review.id));

    expect(flags).toHaveLength(1);
    expect(flags[0]!.entityType).toBe('review');
    expect(flags[0]!.source).toBe('auto');
    expect(flags[0]!.reason).toContain('offensive');
  });

  it('inserts one moderation_flag per image when body is flagged', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Contains hateful language.' });
    const img1 = await seedReviewImage({ reviewId: review.id });
    const img2 = await seedReviewImage({ reviewId: review.id });

    await seedBannedTerm({ term: 'hateful', isActive: true, createdBy: admin.id });

    const images = [
      { id: img1.id, sha256: img1.sha256 },
      { id: img2.id, sha256: img2.sha256 },
    ];
    await runModerationScan(testDb as any, review.id, review.body, images);

    const imgFlags = await testDb
      .select()
      .from(moderationFlags)
      .where(eq(moderationFlags.entityType, 'review_image'));

    const imgFlagIds = imgFlags.map((f) => f.entityId);
    expect(imgFlagIds).toContain(img1.id);
    expect(imgFlagIds).toContain(img2.id);
    expect(imgFlags.every((f) => f.source === 'auto')).toBe(true);
  });

  it('writes an audit log entry for each flag created', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Terrible scam product.' });
    const img = await seedReviewImage({ reviewId: review.id });

    await seedBannedTerm({ term: 'scam', isActive: true, createdBy: admin.id });

    await runModerationScan(testDb as any, review.id, review.body, [{ id: img.id, sha256: img.sha256 }]);

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'moderation.flag_created'));

    // 1 for review body + 1 for image
    expect(logs.length).toBeGreaterThanOrEqual(2);
    // System events have null actorId
    expect(logs.every((l) => l.actorId === null)).toBe(true);
  });

  it('flags via regex pattern match', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Call us at 555-1234 for deals!' });

    // Pattern matches phone-like sequences
    await seedBannedTerm({ pattern: '\\d{3}-\\d{4}', isRegex: true, isActive: true, createdBy: admin.id });

    await runModerationScan(testDb as any, review.id, review.body, []);

    const [updated] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updated!.moderationStatus).toBe('flagged');
  });

  it('skips inactive banned terms', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'This review contains inactive_banned_word.' });

    await seedBannedTerm({ term: 'inactive_banned_word', isActive: false, createdBy: admin.id });

    await runModerationScan(testDb as any, review.id, review.body, []);

    const [updated] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updated!.moderationStatus).toBe('pending');
  });

  it('skips an invalid regex pattern without throwing', async () => {
    const admin = await seedUser({ role: 'admin' });
    const user = await seedUser({ role: 'customer' });
    const order = await seedOrder({ customerId: user.id, status: 'picked_up' });
    const review = await seedReview({ orderId: order.id, customerId: user.id, body: 'Normal review with no issues.' });

    // Insert an invalid regex directly into DB (bypassing validation)
    await seedBannedTerm({ pattern: '[invalid(regex', isRegex: true, isActive: true, createdBy: admin.id });

    // Should not throw; invalid patterns are skipped defensively
    await expect(
      runModerationScan(testDb as any, review.id, review.body, []),
    ).resolves.toBeUndefined();

    const [updated] = await testDb.select().from(reviews).where(eq(reviews.id, review.id));
    expect(updated!.moderationStatus).toBe('pending');
  });
});
