import type { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z, uuidParam } from '../lib/zod';
import { carts, cartItems } from '../db/schema/carts';
import { products } from '../db/schema/products';
import { orders, orderItems } from '../db/schema/orders';
import { pickupGroups, pickupGroupItems } from '../db/schema/pickup-groups';
import { auditLogs } from '../db/schema/audit-logs';
import { isStaff } from '../lib/roles';
import { sendError } from '../lib/reply';

// ── Shared error sentinel ─────────────────────────────────────────────────────

/**
 * Thrown inside Drizzle transactions to abort them cleanly and surface the
 * correct HTTP status code in the outer catch block.
 */
class CartError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const addItemBody = z.object({
  productId: z.string().uuid(),
  /** Quantity to add — must be at least 1. */
  qty: z.number().int().min(1),
});

const updateItemBody = z.object({
  /** New desired quantity — must be at least 1. */
  qty: z.number().int().min(1),
});

const createPickupGroupBody = z.object({
  orderId: z.string().uuid(),
  /** Department where items will be staged, e.g. 'front_desk', 'fulfillment', 'warehouse'. */
  department: z.string().min(1).max(100),
});

const assignGroupBody = z.object({
  /** The pickup group this order item should be assigned to. */
  pickupGroupId: z.string().uuid(),
});

const pickupGroupResponse = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  department: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const cartItemResponse = z.object({
  id: z.string().uuid(),
  cartId: z.string().uuid(),
  productId: z.string().uuid(),
  qty: z.number().int(),
  reservedAt: z.string(),
});

const cartResponse = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const cartDetailResponse = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  status: z.string(),
  expiresAt: z.string(),
  /** Seconds until the cart auto-expires; 0 when already past expiry. */
  secondsRemaining: z.number().int(),
  items: z.array(
    z.object({
      id: z.string().uuid(),
      productId: z.string().uuid(),
      /** Included so the frontend can render the cart without a separate product lookup. */
      productName: z.string(),
      price: z.string(),
      qty: z.number().int(),
      reservedAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function cartRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /cart
   *
   * Create a new active cart (30-min TTL). One active cart per customer;
   * returns 409 if one already exists.
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: { 201: cartResponse },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;

      const [existing] = await app.db
        .select({ id: carts.id })
        .from(carts)
        .where(and(eq(carts.customerId, customerId), eq(carts.status, 'active')))
        .limit(1);

      if (existing) {
        return sendError(reply, 409, 'You already have an active cart. Complete or cancel it before creating a new one.');
      }

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      const [created] = await app.db
        .insert(carts)
        .values({
          customerId,
          expiresAt,
          status: 'active',
        })
        .returning();

      return reply.status(201).send({
        id: created.id,
        customerId: created.customerId,
        status: created.status,
        expiresAt: created.expiresAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );
  /**
   * GET /cart
   *
   * Returns the customer's active cart with items and a live expiry countdown.
   * secondsRemaining = max(0, floor((expiresAt - now) / 1000)).
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: { 200: cartDetailResponse },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;

      const [cart] = await app.db
        .select()
        .from(carts)
        .where(and(eq(carts.customerId, customerId), eq(carts.status, 'active')))
        .limit(1);

      if (!cart) {
        return sendError(reply, 404, 'No active cart found.');
      }

      const rows = await app.db
        .select({
          id: cartItems.id,
          productId: cartItems.productId,
          productName: products.name,
          price: products.price,
          qty: cartItems.qty,
          reservedAt: cartItems.reservedAt,
        })
        .from(cartItems)
        .innerJoin(products, eq(cartItems.productId, products.id))
        .where(eq(cartItems.cartId, cart.id));

      const now = Date.now();
      const secondsRemaining = Math.max(
        0,
        Math.floor((cart.expiresAt.getTime() - now) / 1000),
      );

      return reply.status(200).send({
        id: cart.id,
        customerId: cart.customerId,
        status: cart.status,
        expiresAt: cart.expiresAt.toISOString(),
        secondsRemaining,
        items: rows.map((r) => ({
          id: r.id,
          productId: r.productId,
          productName: r.productName,
          price: r.price,
          qty: r.qty,
          reservedAt: r.reservedAt.toISOString(),
        })),
        createdAt: cart.createdAt.toISOString(),
        updatedAt: cart.updatedAt.toISOString(),
      });
    },
  );

  /**
   * POST /cart/items
   *
   * Add a product to the cart and atomically decrement stock. Rejects if the
   * product is already in the cart (use PUT to change qty) or stock is insufficient.
   */
  app.post(
    '/items',
    {
      preHandler: [app.requireAuth],
      schema: {
        body: addItemBody,
        response: { 201: cartItemResponse },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { productId, qty } = req.body;

      let item;
      try {
        item = await app.db.transaction(async (tx) => {
          const [cart] = await tx
            .select({ id: carts.id, expiresAt: carts.expiresAt })
            .from(carts)
            .where(and(eq(carts.customerId, customerId), eq(carts.status, 'active')))
            .limit(1);

          if (!cart) {
            throw new CartError(404, 'No active cart found. Create a cart first via POST /cart.');
          }

          if (cart.expiresAt <= new Date()) {
            throw new CartError(410, 'Cart has expired. Please create a new cart.');
          }

          const [duplicate] = await tx
            .select({ id: cartItems.id })
            .from(cartItems)
            .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)))
            .limit(1);

          if (duplicate) {
            throw new CartError(
              409,
              'Product is already in your cart. Use PUT /cart/items/:id to update the quantity.',
            );
          }

          // Atomically decrement stock — fails if insufficient stock or product inactive
          const [reserved] = await tx
            .update(products)
            .set({ stockQty: sql`${products.stockQty} - ${qty}` })
            .where(
              and(
                eq(products.id, productId),
                eq(products.isActive, true),
                gte(products.stockQty, qty),   // prevents going below 0
              ),
            )
            .returning({ id: products.id });

          if (!reserved) {
            throw new CartError(409, 'Insufficient stock or product not found.');
          }

          const [created] = await tx
            .insert(cartItems)
            .values({ cartId: cart.id, productId, qty })
            .returning();

          return created;
        });
      } catch (err) {
        if (err instanceof CartError) {
          return sendError(reply, err.status, err.message);
        }
        throw err;
      }

      return reply.status(201).send({
        id: item.id,
        cartId: item.cartId,
        productId: item.productId,
        qty: item.qty,
        reservedAt: item.reservedAt.toISOString(),
      });
    },
  );
  /**
   * PUT /cart/items/:id
   *
   * Update cart item quantity and adjust stock reservation by the delta.
   * delta > 0: reserve more stock (409 if insufficient); delta < 0: release stock.
   */
  app.put(
    '/items/:id',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        body: updateItemBody,
        response: { 200: cartItemResponse },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { id } = req.params;
      const { qty: newQty } = req.body;

      let item;
      try {
        item = await app.db.transaction(async (tx) => {
          const [row] = await tx
            .select({
              item: cartItems,
              cartCustomerId: carts.customerId,
              cartStatus: carts.status,
              cartExpiresAt: carts.expiresAt,
            })
            .from(cartItems)
            .innerJoin(carts, eq(cartItems.cartId, carts.id))
            .where(eq(cartItems.id, id))
            .limit(1);

          if (!row) {
            throw new CartError(404, 'Cart item not found.');
          }

          if (row.cartCustomerId !== customerId) {
            throw new CartError(403, 'Cart item does not belong to you.');
          }

          if (row.cartStatus !== 'active') {
            throw new CartError(404, 'Cart is no longer active.');
          }
          if (row.cartExpiresAt <= new Date()) {
            throw new CartError(410, 'Cart has expired. Please create a new cart.');
          }

          const oldQty = row.item.qty;
          const delta = newQty - oldQty;

          if (delta > 0) {
            // Need more units — decrement stock, guard against going negative
            const [reserved] = await tx
              .update(products)
              .set({ stockQty: sql`${products.stockQty} - ${delta}` })
              .where(
                and(
                  eq(products.id, row.item.productId),
                  eq(products.isActive, true),
                  gte(products.stockQty, delta),
                ),
              )
              .returning({ id: products.id });

            if (!reserved) {
              throw new CartError(409, 'Insufficient stock to increase quantity.');
            }
          } else if (delta < 0) {
            await tx
              .update(products)
              .set({ stockQty: sql`${products.stockQty} + ${-delta}` })
              .where(eq(products.id, row.item.productId));
          }
          // delta === 0: no stock adjustment needed

          const [updated] = await tx
            .update(cartItems)
            .set({ qty: newQty })
            .where(eq(cartItems.id, id))
            .returning();

          return updated;
        });
      } catch (err) {
        if (err instanceof CartError) {
          return sendError(reply, err.status, err.message);
        }
        throw err;
      }

      return reply.status(200).send({
        id: item.id,
        cartId: item.cartId,
        productId: item.productId,
        qty: item.qty,
        reservedAt: item.reservedAt.toISOString(),
      });
    },
  );
  /**
   * DELETE /cart/items/:id
   *
   * Remove a cart item and release its stock reservation.
   */
  app.delete(
    '/items/:id',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { id } = req.params;

      try {
        await app.db.transaction(async (tx) => {
          const [row] = await tx
            .select({
              item: cartItems,
              cartCustomerId: carts.customerId,
              cartStatus: carts.status,
              cartExpiresAt: carts.expiresAt,
            })
            .from(cartItems)
            .innerJoin(carts, eq(cartItems.cartId, carts.id))
            .where(eq(cartItems.id, id))
            .limit(1);

          if (!row) {
            throw new CartError(404, 'Cart item not found.');
          }

          if (row.cartCustomerId !== customerId) {
            throw new CartError(403, 'Cart item does not belong to you.');
          }

          if (row.cartStatus !== 'active') {
            throw new CartError(404, 'Cart is no longer active.');
          }
          if (row.cartExpiresAt <= new Date()) {
            throw new CartError(410, 'Cart has expired. Please create a new cart.');
          }

          await tx
            .update(products)
            .set({ stockQty: sql`${products.stockQty} + ${row.item.qty}` })
            .where(eq(products.id, row.item.productId));

          await tx.delete(cartItems).where(eq(cartItems.id, id));
        });
      } catch (err) {
        if (err instanceof CartError) {
          return sendError(reply, err.status, err.message);
        }
        throw err;
      }

      return reply.status(200).send({ ok: true });
    },
  );
  /**
   * POST /cart/pickup-groups
   *
   * Create a pickup group (staging area) for an order. Customer must own the
   * order; staff may manage any. Order must not be in a terminal state.
   */
  app.post(
    '/pickup-groups',
    {
      preHandler: [app.requireAuth],
      schema: {
        body: createPickupGroupBody,
        response: { 201: pickupGroupResponse },
      },
    },
    async (req, reply) => {
      const { orderId, department } = req.body;
      const user = req.user!;

      const [order] = await app.db
        .select({ id: orders.id, customerId: orders.customerId, status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }

      // Authorization: customer must own the order; staff may manage any order
      if (order.customerId !== user.id && !isStaff(user.role)) {
        return sendError(reply, 403, 'Access denied.');
      }

      // Pickup groups cannot be added to terminal orders
      if (order.status === 'cancelled' || order.status === 'picked_up') {
        return sendError(reply, 409, `Cannot add a pickup group to an order with status '${order.status}'.`);
      }

      const [group] = await app.db
        .insert(pickupGroups)
        .values({ orderId, department, status: 'pending' })
        .returning();

      return reply.status(201).send({
        id: group.id,
        orderId: group.orderId,
        department: group.department,
        status: group.status,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      });
    },
  );
  /**
   * PUT /cart/items/:id/group
   *
   * Assign (or reassign) an order item to a pickup group.
   * Blocked once the order or either group reaches staged/picked_up status (SPEC Q2).
   */
  app.put(
    '/items/:id/group',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        body: assignGroupBody,
        response: {
          200: z.object({
            orderItemId: z.string().uuid(),
            pickupGroupId: z.string().uuid(),
            assignedAt: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { id: orderItemId } = req.params;
      const { pickupGroupId } = req.body;
      const user = req.user!;

      const [itemRow] = await app.db
        .select({
          orderItem: orderItems,
          orderId: orders.id,
          orderCustomerId: orders.customerId,
          orderStatus: orders.status,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(eq(orderItems.id, orderItemId))
        .limit(1);

      if (!itemRow) {
        return sendError(reply, 404, 'Order item not found.');
      }

      if (itemRow.orderCustomerId !== user.id && !isStaff(user.role)) {
        return sendError(reply, 403, 'Access denied.');
      }

      // 3. Order-level staging lock (SPEC Q2): once an order reaches ready_for_pickup,
      // pickup_locked, picked_up, or cancelled, all item-to-group reassignments are blocked.
      const LOCKED_ORDER_STATUSES = ['ready_for_pickup', 'pickup_locked', 'picked_up', 'cancelled'] as const;
      if ((LOCKED_ORDER_STATUSES as readonly string[]).includes(itemRow.orderStatus)) {
        return sendError(reply, 409, `Item reassignment is blocked: order status is '${itemRow.orderStatus}'.`);
      }

      const [targetGroup] = await app.db
        .select({ id: pickupGroups.id, orderId: pickupGroups.orderId, status: pickupGroups.status })
        .from(pickupGroups)
        .where(eq(pickupGroups.id, pickupGroupId))
        .limit(1);

      if (!targetGroup) {
        return sendError(reply, 404, 'Pickup group not found.');
      }

      if (targetGroup.orderId !== itemRow.orderId) {
        return sendError(reply, 400, 'Pickup group does not belong to the same order as this item.');
      }

      if (targetGroup.status === 'staged' || targetGroup.status === 'picked_up') {
        return sendError(reply, 409, `Cannot assign to a pickup group with status '${targetGroup.status}'. Reassignment is locked once staged.`);
      }

      const [existing] = await app.db
        .select({ id: pickupGroupItems.id, pickupGroupId: pickupGroupItems.pickupGroupId })
        .from(pickupGroupItems)
        .where(eq(pickupGroupItems.orderItemId, orderItemId))
        .limit(1);

      if (existing && existing.pickupGroupId !== pickupGroupId) {
        const [currentGroup] = await app.db
          .select({ status: pickupGroups.status })
          .from(pickupGroups)
          .where(eq(pickupGroups.id, existing.pickupGroupId))
          .limit(1);

        if (currentGroup && (currentGroup.status === 'staged' || currentGroup.status === 'picked_up')) {
          return sendError(reply, 409, `Cannot reassign item from a pickup group with status '${currentGroup.status}'. Reassignment is locked once staged.`);
        }
      }

      // SPEC Q2: "Logs record any reassignment."
      const isReassignment = existing !== undefined;
      const now = new Date();

      const assignment = await app.db.transaction(async (tx) => {
        let row;

        if (isReassignment) {
          [row] = await tx
            .update(pickupGroupItems)
            .set({ pickupGroupId, assignedAt: now })
            .where(eq(pickupGroupItems.id, existing!.id))
            .returning();
        } else {
          [row] = await tx
            .insert(pickupGroupItems)
            .values({ pickupGroupId, orderItemId, assignedAt: now })
            .returning();
        }

        await tx.insert(auditLogs).values({
          actorId: user.id,
          action: isReassignment ? 'pickup_group.reassigned' : 'pickup_group.assigned',
          entityType: 'order_item',
          entityId: orderItemId,
          before: isReassignment ? { pickupGroupId: existing!.pickupGroupId } : null,
          after: { pickupGroupId },
        });

        return row;
      });

      return reply.status(200).send({
        orderItemId: assignment.orderItemId,
        pickupGroupId: assignment.pickupGroupId,
        assignedAt: assignment.assignedAt.toISOString(),
      });
    },
  );
}

export default cartRoutes;
