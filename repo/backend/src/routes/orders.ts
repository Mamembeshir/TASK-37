import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { z, paginationQuery, uuidParam } from '../lib/zod';
import { carts, cartItems } from '../db/schema/carts';
import { products } from '../db/schema/products';
import { orders, orderItems } from '../db/schema/orders';
import { users } from '../db/schema/users';
import { pickupGroups, pickupGroupItems } from '../db/schema/pickup-groups';
import { tenderSplits } from '../db/schema/tender-splits';
import { auditLogs } from '../db/schema/audit-logs';
import { awardPoints } from '../lib/tier';
import { sendError } from '../lib/reply';
import { generateUniquePickupCode, collapsePickupGroups } from '../lib/pickup';

// ── Response schemas ──────────────────────────────────────────────────────────

const orderSummarySchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listOrdersResponse = z.object({
  data: z.array(orderSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

const tenderSplitSchema = z.object({
  id: z.string().uuid(),
  method: z.enum(['cash', 'card']),
  amount: z.string(),
  reference: z.string().nullable(),
  createdAt: z.string(),
});

const pickupGroupItemSchema = z.object({
  orderItemId: z.string().uuid(),
  assignedAt: z.string(),
});

const pickupGroupSchema = z.object({
  id: z.string().uuid(),
  department: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(pickupGroupItemSchema),
});

const orderDetailResponse = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      productId: z.string().uuid(),
      productName: z.string(),
      qty: z.number().int(),
      unitPrice: z.string(),
      cancelledAt: z.string().nullable(),
      cancellationReason: z.string().nullable(),
      pickupGroupId: z.string().uuid().nullable(),
    }),
  ),
  pickupGroups: z.array(pickupGroupSchema),
  tenderSplits: z.array(tenderSplitSchema),
});

const orderItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  qty: z.number().int(),
  unitPrice: z.string(),
  /** null unless the item was cancelled at order time due to unavailability (task 71). */
  cancelledAt: z.string().nullable(),
  /** Mandatory reason code when cancelled, e.g. 'product_unavailable'. null otherwise. */
  cancellationReason: z.string().nullable(),
});

const createOrderResponse = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.string(),
  /**
   * The 6-digit pickup code shown ONCE to the customer at checkout.
   * This plaintext value is never retrieved again after this response.
   * task 70 will store a bcrypt hash instead of the raw value.
   */
  pickupCode: z.string().length(6),
  items: z.array(orderItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The only accepted currency for tender splits (Q13 confirmed: local currency
 * only; any foreign tender is rejected at the API layer).
 * No currency column exists in the DB — all stored amounts are implicitly USD.
 */
const LOCAL_CURRENCY = 'USD';

// ── Route plugin ──────────────────────────────────────────────────────────────

async function orderRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /orders
   *
   * List the authenticated customer's own orders, newest first.
   * Supports standard pagination (limit/offset).
   * Never exposes pickupCode or pickupCodeIndex.
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: {
        querystring: paginationQuery,
        response: { 200: listOrdersResponse },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { limit, offset } = req.query;

      const [totalRow] = await app.db
        .select({ total: count() })
        .from(orders)
        .where(eq(orders.customerId, customerId));

      const rows = await app.db
        .select({
          id: orders.id,
          customerId: orders.customerId,
          status: orders.status,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
        })
        .from(orders)
        .where(eq(orders.customerId, customerId))
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows.map((r) => ({
          id: r.id,
          customerId: r.customerId,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        total: totalRow.total,
        limit,
        offset,
      });
    },
  );

  /**
   * GET /orders/:id
   *
   * Return full detail for a single order:
   *   - Order metadata (no pickupCode / pickupCodeIndex)
   *   - Items with product name, unit price snapshot, cancellation fields,
   *     and the pickup group they are currently assigned to (nullable)
   *   - Pickup groups with their assigned order-item IDs
   *   - Tender splits recorded so far
   *
   * Authorization: customers may only fetch their own orders.
   * Staff (associate / supervisor / manager / admin) may fetch any order.
   */
  app.get(
    '/:id',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        response: { 200: orderDetailResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const requestingUser = req.user!;

      const [order] = await app.db
        .select({
          id: orders.id,
          customerId: orders.customerId,
          status: orders.status,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
        })
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }

      const isStaff = ['associate', 'supervisor', 'manager', 'admin'].includes(requestingUser.role);
      if (!isStaff && order.customerId !== requestingUser.id) {
        return sendError(reply, 403, 'Access denied.');
      }

      const itemRows = await app.db
        .select({
          id: orderItems.id,
          productId: orderItems.productId,
          productName: products.name,
          qty: orderItems.qty,
          unitPrice: orderItems.unitPrice,
          cancelledAt: orderItems.cancelledAt,
          cancellationReason: orderItems.cancellationReason,
          pickupGroupId: pickupGroupItems.pickupGroupId,
        })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .leftJoin(pickupGroupItems, eq(pickupGroupItems.orderItemId, orderItems.id))
        .where(eq(orderItems.orderId, id));

      const groupRows = await app.db
        .select({
          id: pickupGroups.id,
          department: pickupGroups.department,
          status: pickupGroups.status,
          createdAt: pickupGroups.createdAt,
          updatedAt: pickupGroups.updatedAt,
          orderItemId: pickupGroupItems.orderItemId,
          assignedAt: pickupGroupItems.assignedAt,
        })
        .from(pickupGroups)
        .leftJoin(pickupGroupItems, eq(pickupGroupItems.pickupGroupId, pickupGroups.id))
        .where(eq(pickupGroups.orderId, id));

      const groups = collapsePickupGroups(groupRows);

      const splitRows = await app.db
        .select()
        .from(tenderSplits)
        .where(eq(tenderSplits.orderId, id));

      return reply.send({
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        items: itemRows.map((r) => ({
          id: r.id,
          productId: r.productId,
          productName: r.productName,
          qty: r.qty,
          unitPrice: r.unitPrice,
          cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
          cancellationReason: r.cancellationReason ?? null,
          pickupGroupId: r.pickupGroupId ?? null,
        })),
        pickupGroups: groups.map((g) => ({
          id: g.id,
          department: g.department,
          status: g.status,
          createdAt: g.createdAt.toISOString(),
          updatedAt: g.updatedAt.toISOString(),
          items: g.items.map((i) => ({
            orderItemId: i.orderItemId,
            assignedAt: i.assignedAt.toISOString(),
          })),
        })),
        tenderSplits: splitRows.map((s) => ({
          id: s.id,
          method: s.method,
          amount: s.amount,
          reference: s.reference ?? null,
          createdAt: s.createdAt.toISOString(),
        })),
      });
    },
  );

  /**
   * POST /orders
   *
   * Convert the authenticated customer's active cart into an order.
   * Products that became inactive since cart creation are cancelled with
   * reason 'product_unavailable'; order aborts only if ALL items are unavailable.
   * The 6-digit pickup code is returned once and never stored in plaintext.
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: { 201: createOrderResponse },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;

      const result = await app.db.transaction(async (tx) => {
        const [cart] = await tx
          .select()
          .from(carts)
          .where(and(eq(carts.customerId, customerId), eq(carts.status, 'active')))
          .limit(1);

        if (!cart) {
          return { error: { status: 404, message: 'No active cart found. Create a cart first via POST /cart.' } };
        }

        if (cart.expiresAt <= new Date()) {
          return { error: { status: 410, message: 'Cart has expired. Please create a new cart.' } };
        }

        const rows = await tx
          .select({
            cartItemId: cartItems.id,
            productId: cartItems.productId,
            qty: cartItems.qty,
            productName: products.name,
            productPrice: products.price,
            productIsActive: products.isActive,
          })
          .from(cartItems)
          .innerJoin(products, eq(cartItems.productId, products.id))
          .where(eq(cartItems.cartId, cart.id));

        if (rows.length === 0) {
          return { error: { status: 400, message: 'Cannot place an order with an empty cart.' } };
        }

        // If a product became inactive between cart creation and order placement,
        // cancel that item with reason 'product_unavailable' and release its stock.
        // Abort only if ALL items are unavailable (SPEC: mandatory reason code).
        // Auto-reassignment across pickup groups requires per-location inventory
        // not tracked in the current schema; cancellation is applied instead.
        const now = new Date();
        const activeRows = rows.filter((r) => r.productIsActive);
        const cancelledRows = rows.filter((r) => !r.productIsActive);

        if (activeRows.length === 0) {
          return {
            error: {
              status: 409,
              message: 'All items in your cart are no longer available. Please start a new cart.',
            },
          };
        }

        // Release stock reservations for cancelled items
        for (const row of cancelledRows) {
          await tx
            .update(products)
            .set({ stockQty: sql`${products.stockQty} + ${row.qty}` })
            .where(eq(products.id, row.productId));
        }

        const generated = await generateUniquePickupCode(tx);
        if (!generated) {
          return { error: { status: 500, message: 'Failed to generate a unique pickup code. Please try again.' } };
        }
        const { pickupCode, pickupCodeHash, pickupCodeIndex } = generated;

        const [order] = await tx
          .insert(orders)
          .values({
            customerId,
            status: 'pending',
            pickupCode: pickupCodeHash,       // bcrypt hash — never the plaintext
            pickupCodeIndex,                   // SHA-256 — for uniqueness enforcement
          })
          .returning();

        // Active items inserted normally; cancelled items carry cancelledAt and reason.
        const insertedItems = await tx
          .insert(orderItems)
          .values([
            ...activeRows.map((r) => ({
              orderId: order.id,
              productId: r.productId,
              qty: r.qty,
              unitPrice: r.productPrice,
            })),
            ...cancelledRows.map((r) => ({
              orderId: order.id,
              productId: r.productId,
              qty: r.qty,
              unitPrice: r.productPrice,
              cancelledAt: now,
              cancellationReason: 'product_unavailable',
            })),
          ])
          .returning();

        await tx
          .update(carts)
          .set({ status: 'converted', updatedAt: now })
          .where(eq(carts.id, cart.id));

        // after: key fields — never includes pickupCode or pickupCodeIndex.
        await tx.insert(auditLogs).values({
          actorId: customerId,
          action: 'order.created',
          entityType: 'order',
          entityId: order.id,
          before: null,
          after: {
            id: order.id,
            customerId: order.customerId,
            status: order.status,
            activeItemCount: activeRows.length,
            cancelledItemCount: cancelledRows.length,
            cartId: cart.id,
            createdAt: order.createdAt.toISOString(),
          },
        });

        return {
          order,
          pickupCode,
          items: rows.flatMap((r) => {
            const item = insertedItems.find((i) => i.productId === r.productId);
            if (!item) return [];
            const cancelled = cancelledRows.some((c) => c.productId === r.productId);
            return [{
              id: item.id,
              productId: item.productId,
              productName: r.productName,
              qty: item.qty,
              unitPrice: item.unitPrice,
              cancelledAt: cancelled ? now.toISOString() : null,
              cancellationReason: cancelled ? 'product_unavailable' : null,
            }];
          }),
        };
      });

      if ('error' in result) {
        return sendError(reply, result.error!.status, result.error!.message);
      }

      return reply.status(201).send({
        id: result.order.id,
        customerId: result.order.customerId,
        status: result.order.status,
        pickupCode: result.pickupCode,
        items: result.items,
        createdAt: result.order.createdAt.toISOString(),
        updatedAt: result.order.updatedAt.toISOString(),
      });
    },
  );
  /**
   * POST /orders/:id/tender
   *
   * Record a tender split (cash or card) for an order (staff only).
   * reference is required for card; must be absent/null for cash.
   * Only local currency (USD) is accepted — foreign tender is rejected.
   */
  app.post(
    '/:id/tender',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        body: z
          .object({
            method: z.enum(['cash', 'card']),
            /** Positive decimal, max 2 dp, e.g. "20.00" */
            amount: z
              .string()
              .regex(/^\d+(\.\d{1,2})?$/, 'amount must be a positive decimal (e.g. "20.00")')
              .refine((v) => parseFloat(v) > 0, 'amount must be greater than zero'),
            /** Required for card; must be absent or null for cash. */
            reference: z.string().nullable().optional(),
            /**
             * Currency code for the tender amount (task 77).
             * If provided, must be the local currency ('USD').
             * Foreign currencies are always rejected — Q13 confirmed: local only.
             * Omitting this field is equivalent to supplying 'USD'.
             */
            currency: z.string().optional(),
          })
          .superRefine((data, ctx) => {
            if (data.method === 'card' && !data.reference?.trim()) {
              ctx.addIssue({
                code: 'custom',
                path: ['reference'],
                message: 'reference is required for card tender',
              });
            }
            if (data.method === 'cash' && data.reference) {
              ctx.addIssue({
                code: 'custom',
                path: ['reference'],
                message: 'reference must be null for cash tender',
              });
            }
            // Task 77: reject any explicitly foreign currency (Q13 confirmed).
            if (data.currency && data.currency.toUpperCase() !== LOCAL_CURRENCY) {
              ctx.addIssue({
                code: 'custom',
                path: ['currency'],
                message: `Only local currency (${LOCAL_CURRENCY}) is accepted. Received: '${data.currency}'.`,
              });
            }
          }),
        response: {
          201: z.object({
            id: z.string().uuid(),
            orderId: z.string().uuid(),
            method: z.enum(['cash', 'card']),
            amount: z.string(),
            reference: z.string().nullable(),
            createdAt: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id: orderId } = req.params;
      const { method, amount, reference } = req.body;

      const [order] = await app.db
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }

      if (order.status === 'picked_up' || order.status === 'cancelled') {
        return sendError(reply, 409, `Cannot record tender on an order with status '${order.status}'.`);
      }

      const [split] = await app.db
        .insert(tenderSplits)
        .values({
          orderId,
          method,
          amount,
          reference: reference ?? null,
        })
        .returning();

      // entityType 'tender_split' so reconciliation queries can filter by type.
      await app.db.insert(auditLogs).values({
        actorId: req.user!.id,
        action: 'tender.recorded',
        entityType: 'tender_split',
        entityId: split.id,
        before: null,
        after: {
          id: split.id,
          orderId: split.orderId,
          method: split.method,
          amount: split.amount,
          reference: split.reference ?? null,
          createdAt: split.createdAt.toISOString(),
        },
      });

      return reply.status(201).send({
        id: split.id,
        orderId: split.orderId,
        method: split.method,
        amount: split.amount,
        reference: split.reference ?? null,
        createdAt: split.createdAt.toISOString(),
      });
    },
  );

  /**
   * POST /orders/:id/confirm
   *
   * Finalise payment (staff only). Validates that tender totals match order
   * total using integer cents arithmetic. Transitions: pending → confirmed.
   */
  app.post(
    '/:id/confirm',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        response: {
          200: z.object({
            id: z.string().uuid(),
            status: z.literal('confirmed'),
            orderTotalCents: z.number().int(),
            tenderTotalCents: z.number().int(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id: orderId } = req.params;

      const [order] = await app.db
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }

      if (order.status !== 'pending') {
        return sendError(reply, 409, `Order can only be confirmed from 'pending' status (current: '${order.status}').`);
      }

      // Integer cents arithmetic throughout to avoid floating-point drift.
      const itemRows = await app.db
        .select({ unitPrice: orderItems.unitPrice, qty: orderItems.qty })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.cancelledAt)));

      if (itemRows.length === 0) {
        return sendError(reply, 409, 'Order has no active items; cannot confirm.');
      }

      const orderTotalCents = itemRows.reduce(
        (acc, r) => acc + Math.round(parseFloat(r.unitPrice) * r.qty * 100),
        0,
      );

      const splitRows = await app.db
        .select({ amount: tenderSplits.amount })
        .from(tenderSplits)
        .where(eq(tenderSplits.orderId, orderId));

      if (splitRows.length === 0) {
        return sendError(reply, 422, 'No tender splits recorded. Add at least one tender split before confirming.');
      }

      const tenderTotalCents = splitRows.reduce(
        (acc, r) => acc + Math.round(parseFloat(r.amount) * 100),
        0,
      );

      if (tenderTotalCents !== orderTotalCents) {
        const orderTotal = (orderTotalCents / 100).toFixed(2);
        const tenderTotal = (tenderTotalCents / 100).toFixed(2);
        return sendError(reply, 422, `Tender total $${tenderTotal} does not match order total $${orderTotal}. Adjust splits before confirming.`);
      }

      await app.db
        .update(orders)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      await app.db.insert(auditLogs).values({
        actorId: req.user!.id,
        action: 'order.confirmed',
        entityType: 'order',
        entityId: orderId,
        before: { status: 'pending' },
        after: {
          status: 'confirmed',
          orderTotalCents,
          tenderTotalCents,
        },
      });

      return reply.send({
        id: orderId,
        status: 'confirmed' as const,
        orderTotalCents,
        tenderTotalCents,
      });
    },
  );

  /**
   * POST /orders/:id/pickup/verify
   *
   * Verify the customer's 6-digit pickup code (staff only).
   * Order must be 'ready_for_pickup'. Locks after 5 failed attempts (→ 'pickup_locked').
   * On success: order → 'picked_up' and loyalty points are awarded.
   */
  app.post(
    '/:id/pickup/verify',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        body: z.object({
          /** Exactly 6 digits, e.g. "042817" */
          code: z
            .string()
            .regex(/^\d{6}$/, 'code must be exactly 6 digits'),
        }),
        response: {
          200: z.object({
            verified: z.boolean(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id: orderId } = req.params;
      const { code } = req.body;

      const [order] = await app.db
        .select({
          id: orders.id,
          customerId: orders.customerId,
          status: orders.status,
          pickupCode: orders.pickupCode,
          pickupAttempts: orders.pickupAttempts,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }

      if (order.status === 'pickup_locked') {
        return sendError(reply, 423, 'Order is locked after too many failed attempts. Manager override required.');
      }

      if (order.status !== 'ready_for_pickup') {
        return sendError(reply, 409, `Pickup verification is only available for orders with status 'ready_for_pickup' (current: '${order.status}').`);
      }

      // Defensive: pickupCode should always be set for a real order
      if (!order.pickupCode) {
        return sendError(reply, 500, 'Order has no pickup code on record.');
      }

      const verified = await bcrypt.compare(code, order.pickupCode);

      await app.db.transaction(async (tx) => {
        if (verified) {
          await tx
            .update(orders)
            .set({ status: 'picked_up', updatedAt: new Date() })
            .where(eq(orders.id, orderId));

          await tx.insert(auditLogs).values({
            actorId: req.user!.id,
            action: 'pickup.verified',
            entityType: 'order',
            entityId: orderId,
            before: { status: 'ready_for_pickup', pickupAttempts: order.pickupAttempts },
            after: { status: 'picked_up' },
          });

          // Award loyalty points with tier-based multiplier (Q8).
          await awardPoints(app.db, order.customerId, orderId);
        } else {
          // Increment attempts, lock at 5 (Q1).
          const newAttempts = order.pickupAttempts + 1;
          const shouldLock = newAttempts >= 5;
          const newStatus = shouldLock ? 'pickup_locked' : order.status;

          await tx
            .update(orders)
            .set({
              pickupAttempts: newAttempts,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

          await tx.insert(auditLogs).values({
            actorId: req.user!.id,
            action: 'pickup.verify_failed',
            entityType: 'order',
            entityId: orderId,
            before: { status: order.status, pickupAttempts: order.pickupAttempts },
            after: { status: newStatus, pickupAttempts: newAttempts },
          });
        }
      });

      return reply.send({ verified });
    },
  );

  /**
   * POST /orders/:id/pickup/manager-override
   *
   * Authorise handoff for a 'pickup_locked' order without a valid code.
   * Manager credentials are verified inline (no session switch). On success:
   * order → 'picked_up' and loyalty points are awarded.
   */
  app.post(
    '/:id/pickup/manager-override',
    {
      preHandler: [
        app.requireAuth,
        app.requireRole('associate', 'supervisor', 'manager', 'admin'),
      ],
      schema: {
        params: uuidParam,
        body: z.object({
          managerUsername: z.string().min(1),
          managerPassword: z.string().min(1),
        }),
        response: {
          200: z.object({ overridden: z.literal(true) }),
        },
      },
    },
    async (req, reply) => {
      const { id: orderId } = req.params;
      const { managerUsername, managerPassword } = req.body;

      const [order] = await app.db
        .select({ id: orders.id, status: orders.status, customerId: orders.customerId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }

      if (order.status !== 'pickup_locked') {
        return sendError(reply, 409, `Manager override is only available for 'pickup_locked' orders (current: '${order.status}').`);
      }

      const [manager] = await app.db
        .select({
          id: users.id,
          role: users.role,
          passwordHash: users.passwordHash,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(eq(users.username, managerUsername))
        .limit(1);

      if (!manager) {
        return sendError(reply, 401, 'Invalid manager credentials.');
      }

      if (manager.role !== 'manager' && manager.role !== 'admin') {
        return sendError(reply, 403, 'Supplied credentials do not belong to a manager or admin account.');
      }

      if (manager.lockedUntil && manager.lockedUntil > new Date()) {
        return sendError(reply, 423, 'Manager account is temporarily locked. Try again later.');
      }

      const passwordValid = await bcrypt.compare(managerPassword, manager.passwordHash);
      if (!passwordValid) {
        return sendError(reply, 401, 'Invalid manager credentials.');
      }

      await app.db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({ status: 'picked_up', updatedAt: new Date() })
          .where(eq(orders.id, orderId));

        await tx.insert(auditLogs).values({
          actorId: manager.id,
          action: 'pickup.manager_override',
          entityType: 'order',
          entityId: orderId,
          before: { status: 'pickup_locked' },
          after: { status: 'picked_up', authorisedBy: manager.id },
        });

        await awardPoints(app.db, order.customerId, orderId);
      });

      return reply.send({ overridden: true });
    },
  );
}

export default orderRoutes;
