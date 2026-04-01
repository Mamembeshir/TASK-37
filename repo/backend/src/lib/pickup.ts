import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createHash, randomInt } from 'node:crypto';
import bcrypt from 'bcrypt';
import { orders } from '../db/schema/orders';

type Db = FastifyInstance['db'];

/**
 * Generate a cryptographically random 6-digit pickup code with uniqueness
 * enforcement via SHA-256 index check. Retries up to 10 times on collision
 * (1M codes, few active orders — collision is extremely rare).
 * Returns null if all 10 attempts collide (caller should return HTTP 500).
 */
export async function generateUniquePickupCode(tx: Db): Promise<{
  pickupCode: string;
  pickupCodeHash: string;
  pickupCodeIndex: string;
} | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const candidateIndex = createHash('sha256').update(candidate).digest('hex');

    const [collision] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.pickupCodeIndex, candidateIndex))
      .limit(1);

    if (!collision) {
      return {
        pickupCode: candidate,
        pickupCodeIndex: candidateIndex,
        pickupCodeHash: await bcrypt.hash(candidate, 10),
      };
    }
  }
  return null;
}

type GroupRow = {
  id: string;
  department: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  orderItemId: string | null;
  assignedAt: Date | null;
};

/**
 * Collapse flat join rows (one row per pickup-group-item) into group objects
 * each with an items array.
 */
export function collapsePickupGroups(groupRows: GroupRow[]) {
  const groupMap = new Map<string, {
    id: string; department: string; status: string;
    createdAt: Date; updatedAt: Date;
    items: { orderItemId: string; assignedAt: Date }[];
  }>();

  for (const r of groupRows) {
    if (!groupMap.has(r.id)) {
      groupMap.set(r.id, {
        id: r.id,
        department: r.department,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        items: [],
      });
    }
    if (r.orderItemId && r.assignedAt) {
      groupMap.get(r.id)!.items.push({ orderItemId: r.orderItemId, assignedAt: r.assignedAt });
    }
  }

  return [...groupMap.values()];
}
