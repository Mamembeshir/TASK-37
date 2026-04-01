/**
 * Unit tests for lib/pickup.ts:
 *   - collapsePickupGroups — pure function, no DB
 *   - generateUniquePickupCode — requires real DB (uniqueness guard)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { collapsePickupGroups, generateUniquePickupCode } from './pickup.js';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { seedUser } from '../test/helpers.js';
import { orders } from '../db/schema/orders.js';

// ── collapsePickupGroups ──────────────────────────────────────────────────────

describe('collapsePickupGroups', () => {
  it('returns empty array for empty input', () => {
    expect(collapsePickupGroups([])).toEqual([]);
  });

  it('returns one group with no items when orderItemId is null', () => {
    const now = new Date();
    const rows = [
      {
        id: 'group-1',
        department: 'front_desk',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: null,
        assignedAt: null,
      },
    ];
    const groups = collapsePickupGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'group-1', department: 'front_desk', status: 'pending' });
    expect(groups[0]!.items).toEqual([]);
  });

  it('returns one group with one item', () => {
    const now = new Date();
    const rows = [
      {
        id: 'group-1',
        department: 'fulfillment',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-1',
        assignedAt: now,
      },
    ];
    const groups = collapsePickupGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[0]!.items[0]).toEqual({ orderItemId: 'item-1', assignedAt: now });
  });

  it('collapses multiple rows for the same group into one group with multiple items', () => {
    const now = new Date();
    const rows = [
      {
        id: 'group-1',
        department: 'warehouse',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-1',
        assignedAt: now,
      },
      {
        id: 'group-1',
        department: 'warehouse',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-2',
        assignedAt: now,
      },
    ];
    const groups = collapsePickupGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
    const itemIds = groups[0]!.items.map((i) => i.orderItemId);
    expect(itemIds).toContain('item-1');
    expect(itemIds).toContain('item-2');
  });

  it('returns multiple groups each with their own items', () => {
    const now = new Date();
    const rows = [
      {
        id: 'group-A',
        department: 'front_desk',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-1',
        assignedAt: now,
      },
      {
        id: 'group-B',
        department: 'warehouse',
        status: 'staged',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-2',
        assignedAt: now,
      },
      {
        id: 'group-A',
        department: 'front_desk',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-3',
        assignedAt: now,
      },
    ];
    const groups = collapsePickupGroups(rows);
    expect(groups).toHaveLength(2);

    const groupA = groups.find((g) => g.id === 'group-A')!;
    const groupB = groups.find((g) => g.id === 'group-B')!;

    expect(groupA.items).toHaveLength(2);
    expect(groupB.items).toHaveLength(1);
    expect(groupA.items.map((i) => i.orderItemId)).toContain('item-1');
    expect(groupA.items.map((i) => i.orderItemId)).toContain('item-3');
    expect(groupB.items[0]!.orderItemId).toBe('item-2');
  });

  it('handles a group row where assignedAt is null — item not added', () => {
    const now = new Date();
    const rows = [
      {
        id: 'group-1',
        department: 'front_desk',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        orderItemId: 'item-1',
        assignedAt: null, // null assignedAt → item not pushed
      },
    ];
    const groups = collapsePickupGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(0);
  });
});

// ── generateUniquePickupCode ──────────────────────────────────────────────────

describe('generateUniquePickupCode', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await clearAllTables();
    await closeDb();
  });

  it('returns a 6-character string of digits', async () => {
    const result = await generateUniquePickupCode(testDb as any);
    expect(result).not.toBeNull();
    expect(result!.pickupCode).toMatch(/^\d{6}$/);
  });

  it('pickupCodeIndex equals SHA-256 of the plaintext code', async () => {
    const result = await generateUniquePickupCode(testDb as any);
    expect(result).not.toBeNull();
    const expected = createHash('sha256').update(result!.pickupCode).digest('hex');
    expect(result!.pickupCodeIndex).toBe(expected);
  });

  it('pickupCodeHash is a bcrypt hash that verifies against the plaintext code', async () => {
    const result = await generateUniquePickupCode(testDb as any);
    expect(result).not.toBeNull();
    const ok = await bcrypt.compare(result!.pickupCode, result!.pickupCodeHash);
    expect(ok).toBe(true);
  });

  it('successive calls produce different codes', async () => {
    const r1 = await generateUniquePickupCode(testDb as any);
    const r2 = await generateUniquePickupCode(testDb as any);
    // With 1 million possible codes the chance of a collision here is ~1 in 10^6
    expect(r1!.pickupCode).not.toBe(r2!.pickupCode);
  });

  it('skips a code that is already in the DB (collision detection)', async () => {
    // Pre-occupy code "000001"
    const knownCode = '000001';
    const knownIndex = createHash('sha256').update(knownCode).digest('hex');
    const user = await seedUser({ username: `coluser_${Date.now()}` });
    const knownHash = await bcrypt.hash(knownCode, 4);

    await testDb.insert(orders).values({
      customerId: user.id,
      status: 'pending',
      pickupCode: knownHash,
      pickupCodeIndex: knownIndex,
    });

    // The function should return a different code (it retries up to 10 times)
    const result = await generateUniquePickupCode(testDb as any);
    expect(result).not.toBeNull();
    // The returned index must not be the one we occupied
    expect(result!.pickupCodeIndex).not.toBe(knownIndex);

    // Cleanup
    await testDb.delete(orders).where(eq(orders.pickupCodeIndex, knownIndex));
  });
});
