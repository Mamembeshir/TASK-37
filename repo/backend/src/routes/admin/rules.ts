import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import { z, uuidParam, paginationQuery } from '../../lib/zod';
import { rules, rulesHistory } from '../../db/schema/rules';
import { auditLogs } from '../../db/schema/audit-logs';
import { ruleDefinitionSchema } from '@retail-hub/shared';
import { sendError } from '../../lib/reply';

// ── Response schemas ──────────────────────────────────────────────────────────

const ruleSummaryOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  version: z.number().int(),
  status: z.string(),
  adminComment: z.string(),
  createdBy: z.string().uuid(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ruleDetailOut = ruleSummaryOut.extend({
  definitionJson: z.unknown(),
});

const rulesListOut = z.object({
  data: z.array(ruleSummaryOut),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRuleSummary(r: typeof rules.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    status: r.status,
    adminComment: r.adminComment,
    createdBy: r.createdBy,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ── Route plugin ──────────────────────────────────────────────────────────────

async function adminRulesRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /admin/rules
   *
   * List all rule sets (all statuses) with pagination, newest first.
   * Auth: admin only.
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        querystring: paginationQuery,
        response: { 200: rulesListOut },
      },
    },
    async (req, reply) => {
      const { limit, offset } = req.query;

      const [{ totalCount }] = await app.db
        .select({ totalCount: count() })
        .from(rules);

      const rows = await app.db
        .select()
        .from(rules)
        .orderBy(desc(rules.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows.map(toRuleSummary),
        total: totalCount ?? 0,
        limit,
        offset,
      });
    },
  );

  /**
   * GET /admin/rules/:id
   *
   * Rule detail including the full definition JSON.
   * Auth: admin only.
   */
  app.get(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        response: { 200: ruleDetailOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      const [rule] = await app.db
        .select()
        .from(rules)
        .where(eq(rules.id, id))
        .limit(1);

      if (!rule) {
        return sendError(reply, 404, 'Rule not found.');
      }

      return reply.send({ ...toRuleSummary(rule), definitionJson: rule.definitionJson });
    },
  );

  /**
   * POST /admin/rules
   *
   * Create a new rule set (status: draft). Requires admin_comment.
   * The definition JSON is validated against the shared ruleDefinitionSchema.
   * Auth: admin only.
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        body: z.object({
          name: z.string().min(1).max(255),
          adminComment: z.string().min(1).max(2000),
          definitionJson: ruleDefinitionSchema,
        }),
        response: { 201: ruleDetailOut },
      },
    },
    async (req, reply) => {
      const { name, adminComment, definitionJson } = req.body;
      const actorId = req.user!.id;

      // Ensure name is unique
      const [existing] = await app.db
        .select({ id: rules.id })
        .from(rules)
        .where(eq(rules.name, name))
        .limit(1);

      if (existing) {
        return sendError(reply, 409, `A rule named '${name}' already exists.`);
      }

      const [created] = await app.db
        .insert(rules)
        .values({
          name,
          adminComment,
          definitionJson,
          createdBy: actorId,
        })
        .returning();

      return reply.status(201).send({ ...toRuleSummary(created), definitionJson: created.definitionJson });
    },
  );

  /**
   * PUT /admin/rules/:id
   *
   * Update a rule: snapshot current version into rules_history, then apply
   * the update and auto-increment version. Requires admin_comment.
   * Auth: admin only.
   */
  app.put(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          adminComment: z.string().min(1).max(2000),
          definitionJson: ruleDefinitionSchema.optional(),
        }),
        response: { 200: ruleDetailOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { name, adminComment, definitionJson } = req.body;
      const actorId = req.user!.id;

      const [rule] = await app.db
        .select()
        .from(rules)
        .where(eq(rules.id, id))
        .limit(1);

      if (!rule) {
        return sendError(reply, 404, 'Rule not found.');
      }

      // If renaming, ensure the new name is not taken by a different rule
      if (name && name !== rule.name) {
        const [conflict] = await app.db
          .select({ id: rules.id })
          .from(rules)
          .where(eq(rules.name, name))
          .limit(1);

        if (conflict) {
          return sendError(reply, 409, `A rule named '${name}' already exists.`);
        }
      }

      const now = new Date();

      const [updated] = await app.db.transaction(async (tx) => {
        // Archive current version to rules_history
        await tx.insert(rulesHistory).values({
          ruleId: id,
          version: rule.version,
          status: rule.status,
          definitionJson: rule.definitionJson,
          adminComment: rule.adminComment,
          createdBy: rule.createdBy,
          publishedAt: rule.publishedAt ?? null,
        });

        // Apply update; auto-increment version
        return tx
          .update(rules)
          .set({
            ...(name ? { name } : {}),
            ...(definitionJson ? { definitionJson } : {}),
            adminComment,
            version: rule.version + 1,
            // Editing an active rule demotes it back to draft (pending re-publish)
            status: rule.status === 'active' ? 'draft' : rule.status,
            updatedAt: now,
          })
          .where(eq(rules.id, id))
          .returning();
      });

      return reply.send({ ...toRuleSummary(updated), definitionJson: updated.definitionJson });
    },
  );

  /**
   * POST /admin/rules/:id/publish
   *
   * Publish a rule: set status → 'active', record publishedAt.
   * Any other currently-active rule with the same name is deactivated first
   * (a name uniqueness constraint already prevents duplicates, so this is a
   * belt-and-suspenders guard in case two rules somehow share a group).
   * Auth: admin only.
   */
  app.post(
    '/:id/publish',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        response: { 200: ruleDetailOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      const [rule] = await app.db
        .select()
        .from(rules)
        .where(eq(rules.id, id))
        .limit(1);

      if (!rule) {
        return sendError(reply, 404, 'Rule not found.');
      }

      if (rule.status === 'active') {
        return sendError(reply, 409, 'Rule is already active.');
      }

      const now = new Date();
      const [updated] = await app.db
        .update(rules)
        .set({ status: 'active', publishedAt: now, updatedAt: now })
        .where(eq(rules.id, id))
        .returning();

      return reply.send({ ...toRuleSummary(updated), definitionJson: updated.definitionJson });
    },
  );

  /**
   * POST /admin/rules/:id/rollback
   *
   * One-click rollback to the previous published version from rules_history.
   * Steps:
   *   1. Find the most recent rules_history row for this rule where
   *      status = 'active' (the last known-good version).
   *   2. Archive the current live version to rules_history.
   *   3. Restore the found snapshot as the new current row, incrementing
   *      version so the history is monotonic.
   *   4. Mark current rule status = 'rolled_back'.
   *   5. Write audit log.
   *
   * Requires admin_comment (Q10: "rollback affects rules, not historical logs").
   * Auth: admin only.
   */
  app.post(
    '/:id/rollback',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        body: z.object({
          adminComment: z.string().min(1).max(2000),
        }),
        response: { 200: ruleDetailOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { adminComment } = req.body;
      const actorId = req.user!.id;

      const [rule] = await app.db
        .select()
        .from(rules)
        .where(eq(rules.id, id))
        .limit(1);

      if (!rule) {
        return sendError(reply, 404, 'Rule not found.');
      }

      // Find the most recent previously-published version in history
      const [previousPublished] = await app.db
        .select()
        .from(rulesHistory)
        .where(
          and(
            eq(rulesHistory.ruleId, id),
            eq(rulesHistory.status, 'active'),
            isNotNull(rulesHistory.publishedAt),
          ),
        )
        .orderBy(desc(rulesHistory.archivedAt))
        .limit(1);

      if (!previousPublished) {
        return sendError(reply, 409, 'No previous version found in history to roll back to.');
      }

      const now = new Date();

      const [updated] = await app.db.transaction(async (tx) => {
        // Archive current version marked as rolled_back
        await tx.insert(rulesHistory).values({
          ruleId: id,
          version: rule.version,
          status: 'rolled_back',
          definitionJson: rule.definitionJson,
          adminComment: rule.adminComment,
          createdBy: rule.createdBy,
          publishedAt: rule.publishedAt ?? null,
        });

        // Restore previous snapshot, incrementing version monotonically
        const rows = await tx
          .update(rules)
          .set({
            definitionJson: previousPublished.definitionJson,
            adminComment,
            version: rule.version + 1,
            status: 'active',
            publishedAt: now,
            updatedAt: now,
          })
          .where(eq(rules.id, id))
          .returning();

        // Immutable audit log (Q10: rollback affects rules, not historical logs)
        await tx.insert(auditLogs).values({
          actorId,
          action: 'rule.rolled_back',
          entityType: 'rule',
          entityId: id,
          before: {
            version: rule.version,
            status: rule.status,
            adminComment: rule.adminComment,
          },
          after: {
            version: rule.version + 1,
            status: 'active',
            restoredFromVersion: previousPublished.version,
            adminComment,
          },
        });

        return rows;
      });

      return reply.send({ ...toRuleSummary(updated), definitionJson: updated.definitionJson });
    },
  );
}

export default adminRulesRoutes;
