/**
 * Customer loyalty tier definitions and points award logic.
 *
 * Task 138 — defines the four tier levels and their point thresholds.
 * Task 139 — top-tier customers bypass the $50 price-adjustment cap (enforced
 *             in routes/tickets.ts by passing the real tier to the rules engine).
 * Task 140 — points multipliers applied at pickup via the rules engine; these
 *             constants serve as the authoritative fallback when no matching
 *             'points_multiplier' rule exists in the DB.
 *
 * Rule integration:
 *   Admins may override multipliers by publishing rules with:
 *     group: 'points_multiplier', evaluation_mode: 'parallel'
 *     action type: 'points_multiplier', params.multiplier: <number>
 *   If such a rule matches, it takes precedence over TIER_MULTIPLIERS below.
 *
 *   Admins may also publish a rule with:
 *     group: 'price_adjustment', action type: 'override_cap'
 *   for top-tier customers to bypass the $50 cap (task 139).
 */

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { users } from '../db/schema/users';
import { tenderSplits } from '../db/schema/tender-splits';
import { evaluateRules, getAction } from '../rules-engine/index';
import type { CustomerTier } from '../db/schema/users';

type Db = FastifyInstance['db'];

// ── Tier thresholds (task 138) ────────────────────────────────────────────────

/**
 * Minimum points required to hold each tier.
 * These are the canonical tier definitions for the system.
 */
export const TIER_THRESHOLDS: Record<CustomerTier, number> = {
  standard: 0,
  silver: 1_000,
  gold: 5_000,
  top: 10_000,
};

// ── Points multipliers (task 140 — fallback when no rule overrides) ───────────

/**
 * Default points multiplier per tier.
 * 1 base point = $1 spent (floor of order total paid).
 * The rules engine may return a higher or lower multiplier via the
 * 'points_multiplier' action in the 'points_multiplier' rule group.
 */
export const TIER_MULTIPLIERS: Record<CustomerTier, number> = {
  standard: 1,
  silver: 1.5,
  gold: 2,
  top: 3,
};

// ── Tier computation ──────────────────────────────────────────────────────────

/**
 * Derive the correct tier from a points balance.
 * Returns the highest tier whose threshold is met.
 */
export function computeTier(points: number): CustomerTier {
  if (points >= TIER_THRESHOLDS.top) return 'top';
  if (points >= TIER_THRESHOLDS.gold) return 'gold';
  if (points >= TIER_THRESHOLDS.silver) return 'silver';
  return 'standard';
}

// ── Points award (tasks 140) ─────────────────────────────────────────────────

/**
 * Award loyalty points to a customer after their order is picked up.
 *
 * Steps:
 *   1. Load the customer's current tier from DB.
 *   2. Sum the order's tender splits to get total amount paid.
 *   3. Compute base points = floor(totalPaid) — 1 pt per $1 spent.
 *   4. Run rules engine with group='points_multiplier' to find the applicable
 *      multiplier for the customer's tier (task 140).
 *      Falls back to TIER_MULTIPLIERS if no matching rule exists.
 *   5. Add earned points to the customer's balance, recompute their tier,
 *      and persist both in one UPDATE.
 *
 * This is called atomically within the same transaction as the order
 * status → 'picked_up' update in routes/orders.ts.
 */
export async function awardPoints(
  db: Db,
  customerId: string,
  orderId: string,
): Promise<void> {
  // 1. Load current customer tier
  const [user] = await db
    .select({ points: users.points, tier: users.tier })
    .from(users)
    .where(eq(users.id, customerId))
    .limit(1);

  if (!user) return; // safety — should never happen for a valid order

  // 2. Sum tender splits → total paid
  const splits = await db
    .select({ amount: tenderSplits.amount })
    .from(tenderSplits)
    .where(eq(tenderSplits.orderId, orderId));

  const totalPaid = splits.reduce((sum, s) => sum + parseFloat(s.amount), 0);
  const basePoints = Math.floor(totalPaid);
  if (basePoints <= 0) return; // no points for zero-value orders

  // 3. Resolve multiplier via rules engine (task 140)
  const context = { 'customer.tier': user.tier };
  const matches = await evaluateRules(db, context, { group: 'points_multiplier' });
  const multiplierAction = getAction(matches, 'points_multiplier');

  const multiplier =
    typeof multiplierAction?.params?.multiplier === 'number'
      ? multiplierAction.params.multiplier
      : TIER_MULTIPLIERS[user.tier as CustomerTier] ?? 1;

  // 4. Compute and persist new balance + tier
  const earned = Math.round(basePoints * multiplier);
  const newPoints = user.points + earned;
  const newTier = computeTier(newPoints);

  await db
    .update(users)
    .set({ points: newPoints, tier: newTier, updatedAt: new Date() })
    .where(eq(users.id, customerId));
}
