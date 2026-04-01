/**
 * Background job: expire stale carts and release stock reservations.
 *
 * SPEC / Q7: "Carts reserve stock for 30 minutes before auto-cancel;
 *             user must start a new order; cart cannot resume.
 *             Logs record expiration timestamp."
 *
 * Runs on a 60-second interval via setInterval in index.ts.
 * Each run executes a single transaction that:
 *   1. Finds all active carts where expiresAt <= now().
 *   2. For each expired cart, fetches its items and restores stock_qty.
 *   3. Marks the cart status = 'expired'.
 *   4. Writes an immutable audit log entry (actorId = null — system event).
 *
 * If the transaction fails, the error is logged and retried on the next tick.
 * No cart or stock is left in a partial state because everything is wrapped in
 * one atomic transaction.
 */

import { and, eq, lte, sql } from 'drizzle-orm';
import type { db as DbType } from '../db/index';
import { carts, cartItems } from '../db/schema/carts';
import { products } from '../db/schema/products';
import { auditLogs } from '../db/schema/audit-logs';

export async function runExpireCartsJob(db: typeof DbType): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Find all active carts that have passed their expiry time
    const expiredCarts = await tx
      .select({ id: carts.id, customerId: carts.customerId })
      .from(carts)
      .where(and(eq(carts.status, 'active'), lte(carts.expiresAt, now)));

    if (expiredCarts.length === 0) return;

    for (const cart of expiredCarts) {
      // 2. Fetch all items for this cart to know how much stock to release
      const items = await tx
        .select({ productId: cartItems.productId, qty: cartItems.qty })
        .from(cartItems)
        .where(eq(cartItems.cartId, cart.id));

      // 3. Release stock reservation for every item
      for (const item of items) {
        await tx
          .update(products)
          .set({ stockQty: sql`${products.stockQty} + ${item.qty}` })
          .where(eq(products.id, item.productId));
      }

      // 4. Mark the cart as expired
      await tx
        .update(carts)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(carts.id, cart.id));

      // 5. Write immutable audit log — actorId null (system-generated event per schema comment)
      await tx.insert(auditLogs).values({
        actorId: null,
        action: 'cart.expired',
        entityType: 'cart',
        entityId: cart.id,
        before: { status: 'active' },
        after: { status: 'expired', expiredAt: now.toISOString() },
      });
    }
  });
}
