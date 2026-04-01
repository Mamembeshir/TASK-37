import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z, uuidParam } from '../lib/zod';
import { users } from '../db/schema/users';
import { TIER_THRESHOLDS, TIER_MULTIPLIERS } from '../lib/tier';
import type { CustomerTier } from '../db/schema/users';
import { sendError } from '../lib/reply';

// ── Response schema ───────────────────────────────────────────────────────────

const pointsOut = z.object({
  customerId: z.string().uuid(),
  points: z.number().int(),
  tier: z.enum(['standard', 'silver', 'gold', 'top']),
  /** Points needed to reach the next tier (null when already at top). */
  pointsToNextTier: z.number().int().nullable(),
  /** The name of the next tier, or null when at top. */
  nextTier: z.enum(['silver', 'gold', 'top']).nullable(),
  /** Tier thresholds for reference (standard, silver, gold, top). */
  tierThresholds: z.object({
    standard: z.number().int(),
    silver: z.number().int(),
    gold: z.number().int(),
    top: z.number().int(),
  }),
  /** Points multiplier active for the customer's current tier. */
  multiplier: z.number(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

const NEXT_TIER: Partial<Record<CustomerTier, Exclude<CustomerTier, 'standard'>>> = {
  standard: 'silver',
  silver: 'gold',
  gold: 'top',
};

// ── Route plugin ──────────────────────────────────────────────────────────────

async function customerRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /customers/:id/points
   *
   * Return a customer's current loyalty points balance, tier, progress to the
   * next tier, and the points multiplier in effect for their current tier.
   *
   * Auth:
   *   - Customer may only fetch their own record.
   *   - Staff (associate+) may fetch any customer's record.
   */
  app.get(
    '/:id/points',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        response: { 200: pointsOut },
      },
    },
    async (req, reply) => {
      const { id: customerId } = req.params;
      const requestingUser = req.user!;
      const isStaff = requestingUser.role !== 'customer';

      // Customers may only view their own points
      if (!isStaff && requestingUser.id !== customerId) {
        return sendError(reply, 403, 'Access denied.');
      }

      const [customer] = await app.db
        .select({ id: users.id, points: users.points, tier: users.tier })
        .from(users)
        .where(eq(users.id, customerId))
        .limit(1);

      if (!customer) {
        return sendError(reply, 404, 'Customer not found.');
      }

      const currentTier = customer.tier as CustomerTier;
      const nextTier = NEXT_TIER[currentTier] ?? null;
      const pointsToNextTier = nextTier
        ? TIER_THRESHOLDS[nextTier] - customer.points
        : null;

      return reply.send({
        customerId: customer.id,
        points: customer.points,
        tier: currentTier,
        pointsToNextTier,
        nextTier,
        tierThresholds: {
          standard: TIER_THRESHOLDS.standard,
          silver: TIER_THRESHOLDS.silver,
          gold: TIER_THRESHOLDS.gold,
          top: TIER_THRESHOLDS.top,
        },
        multiplier: TIER_MULTIPLIERS[currentTier],
      });
    },
  );
}

export default customerRoutes;
