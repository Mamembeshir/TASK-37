import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z, uuidParam } from '../../lib/zod';
import { bannedTerms } from '../../db/schema/banned-terms';
import { auditLogs } from '../../db/schema/audit-logs';
import { sendError } from '../../lib/reply';

// ── Response schema ───────────────────────────────────────────────────────────

const bannedTermOut = z.object({
  id: z.string().uuid(),
  term: z.string().nullable(),
  pattern: z.string().nullable(),
  isRegex: z.boolean(),
  isActive: z.boolean(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function adminBannedTermsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /admin/banned-terms
   *
   * List all banned terms and regex patterns (active and inactive).
   * Auth: admin only.
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        response: { 200: z.array(bannedTermOut) },
      },
    },
    async (_req, reply) => {
      const rows = await app.db.select().from(bannedTerms);

      return reply.send(
        rows.map((r) => ({
          id: r.id,
          term: r.term ?? null,
          pattern: r.pattern ?? null,
          isRegex: r.isRegex,
          isActive: r.isActive,
          createdBy: r.createdBy,
          createdAt: r.createdAt.toISOString(),
        })),
      );
    },
  );

  /**
   * POST /admin/banned-terms
   *
   * Add a banned term (exact substring match) or regex pattern.
   *
   * Auth: admin only.
   *
   * Rules:
   *   - isRegex = false → `term` must be set; `pattern` must be absent/null.
   *   - isRegex = true  → `pattern` must be set; `term` must be absent/null.
   *   - regex patterns are validated at entry so the moderation scanner never
   *     silently skips an invalid pattern (the scanner skips invalid ones
   *     defensively, but the root cause should be prevented here).
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        body: z
          .object({
            term: z.string().min(1).max(500).optional(),
            pattern: z.string().min(1).max(500).optional(),
            isRegex: z.boolean(),
          })
          .superRefine((data, ctx) => {
            if (!data.isRegex) {
              if (!data.term) {
                ctx.addIssue({ code: 'custom', path: ['term'], message: 'term is required when isRegex is false' });
              }
              if (data.pattern) {
                ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'pattern must be absent when isRegex is false' });
              }
            } else {
              if (!data.pattern) {
                ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'pattern is required when isRegex is true' });
              }
              if (data.term) {
                ctx.addIssue({ code: 'custom', path: ['term'], message: 'term must be absent when isRegex is true' });
              }
              // Validate the regex compiles — prevents silently broken patterns in the scanner
              if (data.pattern) {
                try {
                  new RegExp(data.pattern, 'i');
                } catch {
                  ctx.addIssue({ code: 'custom', path: ['pattern'], message: `Invalid regex pattern: "${data.pattern}"` });
                }
              }
            }
          }),
        response: { 201: bannedTermOut },
      },
    },
    async (req, reply) => {
      const { term, pattern, isRegex } = req.body;

      const [created] = await app.db
        .insert(bannedTerms)
        .values({
          term: term ?? null,
          pattern: pattern ?? null,
          isRegex,
          createdBy: req.user!.id,
        })
        .returning();

      return reply.status(201).send({
        id: created.id,
        term: created.term ?? null,
        pattern: created.pattern ?? null,
        isRegex: created.isRegex,
        isActive: created.isActive,
        createdBy: created.createdBy,
        createdAt: created.createdAt.toISOString(),
      });
    },
  );

  /**
   * DELETE /admin/banned-terms/:id
   *
   * Soft-disable a banned term (sets isActive = false).
   * Hard deletion is intentionally avoided to preserve moderation audit history
   * (schema comment: "Allows disabling a term without deleting it").
   *
   * Auth: admin only. Writes immutable audit log.
   */
  app.delete(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        response: { 200: bannedTermOut },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      // Load current state for the audit log `before` snapshot
      const [existing] = await app.db
        .select()
        .from(bannedTerms)
        .where(eq(bannedTerms.id, id))
        .limit(1);

      if (!existing) {
        return sendError(reply, 404, 'Banned term not found.');
      }

      if (!existing.isActive) {
        return sendError(reply, 409, 'Banned term is already disabled.');
      }

      // Soft-disable
      const [disabled] = await app.db
        .update(bannedTerms)
        .set({ isActive: false })
        .where(eq(bannedTerms.id, id))
        .returning();

      // Immutable audit log
      await app.db.insert(auditLogs).values({
        actorId: req.user!.id,
        action: 'banned_term.disabled',
        entityType: 'banned_term',
        entityId: id,
        before: { isActive: true, term: existing.term ?? null, pattern: existing.pattern ?? null },
        after: { isActive: false },
      });

      return reply.send({
        id: disabled.id,
        term: disabled.term ?? null,
        pattern: disabled.pattern ?? null,
        isRegex: disabled.isRegex,
        isActive: disabled.isActive,
        createdBy: disabled.createdBy,
        createdAt: disabled.createdAt.toISOString(),
      });
    },
  );
}

export default adminBannedTermsRoutes;
