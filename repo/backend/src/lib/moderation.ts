import { eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index';
import { reviews } from '../db/schema/reviews';
import { bannedTerms } from '../db/schema/banned-terms';
import { moderationFlags } from '../db/schema/moderation';
import { auditLogs } from '../db/schema/audit-logs';

/**
 * Run offline content moderation on a freshly inserted review (tasks 93–97).
 *
 * Called after both POST /reviews and POST /reviews/:id/followup succeed.
 * Runs entirely offline using the `banned_terms` table — no external services.
 *
 * Steps:
 *   1. Load all active banned terms and patterns from the DB.
 *   2. Scan `reviewBody` for exact (case-insensitive substring) matches and
 *      compiled regex pattern matches (task 93/94).
 *   3. If any match is found:
 *        a. Update review.moderation_status → 'flagged' (task 95).
 *        b. Insert one moderation_flags row for the review body (task 95).
 *        c. Insert one moderation_flags row per image in the review (task 96).
 *           The sha256 is stored in the `after` JSONB so staff can push it to
 *           image_hashes at resolution time (task 100) — imageHashes.flaggedBy
 *           is NOT NULL so it requires a human actor and cannot be set here.
 *        d. Write an audit_logs row for every moderation_flags row created (task 97).
 *   4. If no match: leave review.moderation_status as 'pending' (approved by default scan).
 *
 * @param db       Drizzle DB instance (from FastifyInstance.db or the standalone import)
 * @param reviewId UUID of the just-inserted review
 * @param reviewBody Plain text body to scan
 * @param images   Array of { id, sha256 } for each image attached to the review
 */
export async function runModerationScan(
  db: typeof DbType,
  reviewId: string,
  reviewBody: string,
  images: { id: string; sha256: string }[],
): Promise<void> {
  // 1. Load active banned terms/patterns
  const terms = await db
    .select()
    .from(bannedTerms)
    .where(eq(bannedTerms.isActive, true));

  if (terms.length === 0) {
    // Nothing to scan against — leave status as 'pending'
    return;
  }

  // 2. Scan body text
  const matchedReasons: string[] = [];
  const bodyLower = reviewBody.toLowerCase();

  for (const t of terms) {
    if (!t.isRegex && t.term) {
      // Exact case-insensitive substring match
      if (bodyLower.includes(t.term.toLowerCase())) {
        matchedReasons.push(`banned term matched: "${t.term}"`);
      }
    } else if (t.isRegex && t.pattern) {
      // Compiled regex match — invalid patterns are skipped defensively
      try {
        const re = new RegExp(t.pattern, 'i');
        if (re.test(reviewBody)) {
          matchedReasons.push(`banned pattern matched: "${t.pattern}"`);
        }
      } catch {
        // Invalid regex in the DB is an admin data issue — skip silently.
        // Task 102 (POST /admin/banned-terms) will validate on entry.
      }
    }
  }

  if (matchedReasons.length === 0) {
    // Clean — leave moderation_status as 'pending'
    return;
  }

  // 3a. Mark review as flagged (task 95)
  await db
    .update(reviews)
    .set({ moderationStatus: 'flagged' })
    .where(eq(reviews.id, reviewId));

  const reviewReason = matchedReasons.join('; ');

  // 3b. Insert moderation flag for the review body (task 95)
  const [reviewFlag] = await db
    .insert(moderationFlags)
    .values({
      entityType: 'review',
      entityId: reviewId,
      source: 'auto',
      reason: reviewReason,
    })
    .returning();

  // 3d. Audit log for the review flag (task 97)
  await db.insert(auditLogs).values({
    actorId: null, // system-generated; no human actor for offline auto-scan
    action: 'moderation.flag_created',
    entityType: 'moderation_flag',
    entityId: reviewFlag.id,
    before: null,
    after: {
      entityType: 'review',
      entityId: reviewId,
      source: 'auto',
      reason: reviewReason,
    },
  });

  // 3c. Flag each image attached to the review (task 96).
  //     sha256 is stored in the `after` snapshot so staff can add it to the
  //     image_hashes blocklist when resolving the flag (task 100).
  for (const img of images) {
    const imgReason = `Image attached to flagged review ${reviewId}`;

    const [imgFlag] = await db
      .insert(moderationFlags)
      .values({
        entityType: 'review_image',
        entityId: img.id,
        source: 'auto',
        reason: imgReason,
      })
      .returning();

    // 3d. Audit log for the image flag (task 97)
    await db.insert(auditLogs).values({
      actorId: null,
      action: 'moderation.flag_created',
      entityType: 'moderation_flag',
      entityId: imgFlag.id,
      before: null,
      after: {
        entityType: 'review_image',
        entityId: img.id,
        sha256: img.sha256,
        source: 'auto',
        reason: imgReason,
      },
    });
  }
}
