import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z, uuidParam } from '../../lib/zod';
import { and, eq } from 'drizzle-orm';
import { products } from '../../db/schema/products';
import { auditLogs } from '../../db/schema/audit-logs';
import { sendError } from '../../lib/reply';

// ── Shared product body schema ────────────────────────────────────────────────
// Reused by POST (create) and PUT (update).

/**
 * Price must be a valid fixed-point decimal string matching the
 * numeric(10,2) column — up to 8 digits before the decimal point,
 * 1-2 digits after.  Accepting a string (not a float) avoids IEEE-754
 * rounding errors for money values.
 */
const priceSchema = z
  .string()
  .regex(
    /^\d{1,8}(\.\d{1,2})?$/,
    'Price must be a positive decimal with up to 2 decimal places (e.g. "9.99")',
  );

export const productBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  brand: z.string().max(100).optional(),
  price: priceSchema,
  /** Defaults to 0; must be a non-negative integer. */
  stockQty: z.number().int().nonnegative().default(0),
  category: z.string().max(100).optional(),
});

// ── Response shape ────────────────────────────────────────────────────────────

const productResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  brand: z.string().nullable(),
  price: z.string(),
  stockQty: z.number().int(),
  category: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function adminProductRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /admin/products
   *
   * Create a new product.  Admin only.
   * Writes audit log entry: action=product.created, before=null.
   *
   * Body:
   *   name        — required, max 255 chars
   *   description — optional free text
   *   brand       — optional, max 100 chars
   *   price       — required decimal string e.g. "19.99" (numeric(10,2))
   *   stockQty    — optional integer >= 0, defaults to 0
   *   category    — optional, max 100 chars
   *
   * Returns 201 with the created product.
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        body: productBodySchema,
        response: { 201: productResponse },
      },
    },
    async (req, reply) => {
      const { name, description, brand, price, stockQty, category } = req.body;

      const [created] = await app.db
        .insert(products)
        .values({
          name,
          description: description ?? null,
          brand: brand ?? null,
          price,          // stored as-is; numeric(10,2) in PG handles precision
          stockQty,
          category: category ?? null,
          isActive: true, // new products are always active
        })
        .returning();

      // Immutable audit log — before: null (creation has no prior state)
      await app.db.insert(auditLogs).values({
        actorId: req.user!.id,
        action: 'product.created',
        entityType: 'product',
        entityId: created.id,
        before: null,
        after: {
          name: created.name,
          description: created.description,
          brand: created.brand,
          price: created.price,
          stockQty: created.stockQty,
          category: created.category,
          isActive: created.isActive,
        },
      });

      return reply.status(201).send({
        id: created.id,
        name: created.name,
        description: created.description,
        brand: created.brand,
        price: created.price,
        stockQty: created.stockQty,
        category: created.category,
        isActive: created.isActive,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );
  /**
   * PUT /admin/products/:id
   *
   * Full replacement update of an existing active product.  Admin only.
   * Writes audit log entry inside a transaction: before/after snapshots.
   *
   * All body fields follow the same rules as POST.  isActive is intentionally
   * excluded — soft-delete is handled by DELETE /admin/products/:id.
   *
   * Returns 404 for unknown IDs and soft-deleted products.
   * Returns 200 with the updated product.
   */
  app.put(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
        body: productBodySchema,
        response: { 200: productResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { name, description, brand, price, stockQty, category } = req.body;

      // Wrap in a transaction so the before-snapshot, the update, and the
      // audit log entry are all committed together or not at all.
      const result = await app.db.transaction(async (tx) => {
        // Capture the before-state while holding the row lock
        const [before] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, id), eq(products.isActive, true)))
          .limit(1);

        if (!before) return null;

        // Apply the update
        const [updated] = await tx
          .update(products)
          .set({
            name,
            description: description ?? null,
            brand: brand ?? null,
            price,
            stockQty,
            category: category ?? null,
            updatedAt: new Date(),
          })
          .where(eq(products.id, id))
          .returning();

        // Write immutable audit log inside the same transaction
        await tx.insert(auditLogs).values({
          actorId: req.user!.id,
          action: 'product.updated',
          entityType: 'product',
          entityId: id,
          before: {
            name: before.name,
            description: before.description,
            brand: before.brand,
            price: before.price,
            stockQty: before.stockQty,
            category: before.category,
            isActive: before.isActive,
          },
          after: {
            name: updated.name,
            description: updated.description,
            brand: updated.brand,
            price: updated.price,
            stockQty: updated.stockQty,
            category: updated.category,
            isActive: updated.isActive,
          },
        });

        return updated;
      });

      if (!result) {
        return sendError(reply, 404, 'Product not found');
      }

      return reply.status(200).send({
        id: result.id,
        name: result.name,
        description: result.description,
        brand: result.brand,
        price: result.price,
        stockQty: result.stockQty,
        category: result.category,
        isActive: result.isActive,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      });
    },
  );

  /**
   * DELETE /admin/products/:id
   *
   * Soft-delete a product by setting isActive = false.  Admin only.
   * The row is never removed from the database so order history and
   * audit logs that reference this product ID remain intact.
   *
   * Idempotent: deleting an already-soft-deleted product still returns 404
   * (consistent with GET — once invisible, it is treated as non-existent).
   * Writes audit log entry: action=product.deleted, after={ isActive: false }.
   *
   * Returns 200 { ok: true } on success.
   * Returns 404 for unknown IDs or already-soft-deleted products.
   */
  app.delete(
    '/:id',
    {
      preHandler: [app.requireAuth, app.requireRole('admin')],
      schema: {
        params: uuidParam,
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      // UPDATE isActive = false only if the product is currently active.
      // Return the full row (not just id) so we can snapshot before/after
      // in the audit log without a separate SELECT.
      const [deactivated] = await app.db
        .update(products)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, id), eq(products.isActive, true)))
        .returning();

      if (!deactivated) {
        return sendError(reply, 404, 'Product not found');
      }

      // Immutable audit log — before: isActive true, after: isActive false
      await app.db.insert(auditLogs).values({
        actorId: req.user!.id,
        action: 'product.deleted',
        entityType: 'product',
        entityId: deactivated.id,
        before: {
          name: deactivated.name,
          description: deactivated.description,
          brand: deactivated.brand,
          price: deactivated.price,
          stockQty: deactivated.stockQty,
          category: deactivated.category,
          isActive: true, // was active before this operation
        },
        after: {
          isActive: false,
        },
      });

      return reply.status(200).send({ ok: true });
    },
  );
}

export default adminProductRoutes;
