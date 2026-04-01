/**
 * Rich data seed — populates products, orders, reviews, tickets, notifications.
 * Safe to re-run: skips if products already exist.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import {
  users, products, orders, orderItems,
  pickupGroups, pickupGroupItems,
  tenderSplits, reviews,
  afterSalesTickets, ticketEvents,
  notifications, rules, bannedTerms,
} from './schema/index.js';

// ── helpers ────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

function sha256(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

// ── main ───────────────────────────────────────────────────────────────────

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  // Guard: skip if products already seeded
  const existingProducts = await db.execute(sql`SELECT id FROM products LIMIT 1`);
  if (existingProducts.length > 0) {
    console.log('    skipped data seed (products already exist)');
    await client.end();
    return;
  }

  console.log('==> Seeding rich demo data...');

  // ── Fetch seeded user IDs ──────────────────────────────────────────────
  const userRows = await db.execute(
    sql`SELECT id, username, role FROM users WHERE username IN ('customer','associate','supervisor','manager','admin')`
  );
  const byName = Object.fromEntries(userRows.map((r: any) => [r.username, r.id as string]));
  const customerId   = byName['customer'];
  const associateId  = byName['associate'];
  const supervisorId = byName['supervisor'];
  const managerId    = byName['manager'];
  const adminId      = byName['admin'];

  // Update customer tier & points
  await db.execute(sql`
    UPDATE users SET tier = 'gold', points = 2340
    WHERE id = ${customerId}
  `);

  // ── Products ────────────────────────────────────────────────────────────

  const prodIds = {
    headphones:   uuid(), watch:      uuid(), speaker:   uuid(),
    laptopStand:  uuid(), usbHub:     uuid(), sweater:   uuid(),
    shoes:        uuid(), belt:       uuid(), jacket:    uuid(),
    frenchPress:  uuid(), bottle:     uuid(), cuttingBoard: uuid(),
    yogaMat:      uuid(), resistance: uuid(), backpack:  uuid(),
  };

  await db.insert(products).values([
    { id: prodIds.headphones,  name: 'Meridian Pro Wireless Headphones', description: 'Active noise-cancelling over-ear headphones with 40-hour battery and premium leather cushions.', brand: 'Meridian', price: '189.99', stockQty: 24, category: 'Electronics', isActive: true, sortOrder: 1 },
    { id: prodIds.watch,       name: 'Apex Fitness Smartwatch',          description: 'GPS tracking, heart-rate monitor, sleep analysis, and 7-day battery life.', brand: 'Apex', price: '249.00', stockQty: 18, category: 'Electronics', isActive: true, sortOrder: 2 },
    { id: prodIds.speaker,     name: 'SoundCore Mini Bluetooth Speaker', description: 'Portable waterproof speaker, 360° sound, 12-hour playtime.', brand: 'SoundCore', price: '59.95', stockQty: 42, category: 'Electronics', isActive: true, sortOrder: 3 },
    { id: prodIds.laptopStand, name: 'ErgoRise Adjustable Laptop Stand', description: 'Aluminium stand with 6 height levels, foldable and portable.', brand: 'ErgoRise', price: '49.99', stockQty: 31, category: 'Electronics', isActive: true, sortOrder: 4 },
    { id: prodIds.usbHub,      name: 'NexHub 7-Port USB-C Hub',          description: 'Thunderbolt-compatible hub: 2×USB-A, 2×USB-C, HDMI 4K, SD/microSD.', brand: 'NexHub', price: '74.50', stockQty: 20, category: 'Electronics', isActive: true, sortOrder: 5 },
    { id: prodIds.sweater,     name: 'Alpine Merino Wool Sweater',        description: '100% merino wool, mid-layer warmth, machine washable.', brand: 'Alpine', price: '119.00', stockQty: 15, category: 'Apparel', isActive: true, sortOrder: 6 },
    { id: prodIds.shoes,       name: 'TrailRunner X3 Running Shoes',      description: 'Responsive cushioning, breathable mesh upper, non-slip outsole.', brand: 'TrailRunner', price: '134.99', stockQty: 27, category: 'Apparel', isActive: true, sortOrder: 7 },
    { id: prodIds.belt,        name: 'Genuine Leather Dress Belt',        description: 'Full-grain leather, brushed nickel buckle, sizes 28–46.', brand: 'Crafton', price: '45.00', stockQty: 50, category: 'Apparel', isActive: true, sortOrder: 8 },
    { id: prodIds.jacket,      name: 'Urban Denim Jacket',               description: 'Classic washed denim, slim fit, reinforced seams.', brand: 'Urban Co.', price: '98.00', stockQty: 12, category: 'Apparel', isActive: true, sortOrder: 9 },
    { id: prodIds.frenchPress, name: 'Barista Pro French Press 1L',       description: 'Borosilicate glass carafe, stainless steel plunger, heat-retaining sleeve.', brand: 'Barista Pro', price: '39.95', stockQty: 35, category: 'Home', isActive: true, sortOrder: 10 },
    { id: prodIds.bottle,      name: 'HydroKeep Insulated Water Bottle',  description: '1L double-walled stainless steel, keeps cold 24h / hot 12h.', brand: 'HydroKeep', price: '34.00', stockQty: 60, category: 'Home', isActive: true, sortOrder: 11 },
    { id: prodIds.cuttingBoard,name: 'Bamboo Chef Cutting Board Set',     description: 'Set of 3 reversible bamboo boards, juice groove, hanging loop.', brand: 'Chef\'s Select', price: '29.99', stockQty: 28, category: 'Home', isActive: true, sortOrder: 12 },
    { id: prodIds.yogaMat,     name: 'FlexGrip Non-Slip Yoga Mat',        description: '6mm thick TPE mat, alignment lines, carry strap included.', brand: 'FlexGrip', price: '44.99', stockQty: 22, category: 'Sports', isActive: true, sortOrder: 13 },
    { id: prodIds.resistance,  name: 'PowerLoop Resistance Bands Set',    description: '5 resistance levels (15–80 lb), latex-free, includes carry bag.', brand: 'PowerLoop', price: '27.00', stockQty: 48, category: 'Sports', isActive: true, sortOrder: 14 },
    { id: prodIds.backpack,    name: 'Venture 30L Hiking Backpack',       description: 'Waterproof 30L pack, padded hip belt, hydration sleeve, laptop pocket.', brand: 'Venture', price: '149.00', stockQty: 9, category: 'Sports', isActive: true, sortOrder: 15 },
  ] as any[]);
  console.log('    inserted 15 products');

  // ── Order 1: picked_up (completed, 14 days ago) ─────────────────────────

  const ord1Id = uuid();
  const pickupCode1 = '482917';
  const pickupHash1 = await bcrypt.hash(pickupCode1, 10);
  const pickupIndex1 = sha256(pickupCode1);

  await db.insert(orders).values({
    id: ord1Id, customerId,
    status: 'picked_up',
    pickupCode: pickupHash1,
    pickupCodeIndex: pickupIndex1,
    pickupAttempts: 1,
    createdAt: daysAgo(14), updatedAt: daysAgo(13),
  } as any);

  const oi1a = uuid(), oi1b = uuid();
  await db.insert(orderItems).values([
    { id: oi1a, orderId: ord1Id, productId: prodIds.headphones, qty: 1, unitPrice: '189.99' },
    { id: oi1b, orderId: ord1Id, productId: prodIds.bottle,     qty: 2, unitPrice: '34.00' },
  ] as any[]);

  await db.insert(tenderSplits).values([
    { id: uuid(), orderId: ord1Id, method: 'card', amount: '257.99', reference: 'TXN-CC-00481' },
  ] as any[]);

  const pg1Id = uuid();
  await db.insert(pickupGroups).values({
    id: pg1Id, orderId: ord1Id, department: 'front_desk', status: 'picked_up',
    createdAt: daysAgo(14), updatedAt: daysAgo(13),
  } as any);
  await db.insert(pickupGroupItems).values([
    { id: uuid(), pickupGroupId: pg1Id, orderItemId: oi1a },
    { id: uuid(), pickupGroupId: pg1Id, orderItemId: oi1b },
  ] as any[]);

  // ── Order 2: ready_for_pickup (3 days ago) ──────────────────────────────

  const ord2Id = uuid();
  const pickupCode2 = '731604';
  const pickupHash2 = await bcrypt.hash(pickupCode2, 10);
  const pickupIndex2 = sha256(pickupCode2);

  await db.insert(orders).values({
    id: ord2Id, customerId,
    status: 'ready_for_pickup',
    pickupCode: pickupHash2,
    pickupCodeIndex: pickupIndex2,
    pickupAttempts: 0,
    createdAt: daysAgo(5), updatedAt: daysAgo(3),
  } as any);

  const oi2a = uuid(), oi2b = uuid();
  await db.insert(orderItems).values([
    { id: oi2a, orderId: ord2Id, productId: prodIds.watch,    qty: 1, unitPrice: '249.00' },
    { id: oi2b, orderId: ord2Id, productId: prodIds.yogaMat,  qty: 1, unitPrice: '44.99' },
  ] as any[]);

  await db.insert(tenderSplits).values([
    { id: uuid(), orderId: ord2Id, method: 'card', amount: '200.00', reference: 'TXN-CC-00512' },
    { id: uuid(), orderId: ord2Id, method: 'cash', amount: '93.99' },
  ] as any[]);

  const pg2Id = uuid();
  await db.insert(pickupGroups).values({
    id: pg2Id, orderId: ord2Id, department: 'fulfillment', status: 'staged',
    createdAt: daysAgo(5), updatedAt: daysAgo(3),
  } as any);
  await db.insert(pickupGroupItems).values([
    { id: uuid(), pickupGroupId: pg2Id, orderItemId: oi2a },
    { id: uuid(), pickupGroupId: pg2Id, orderItemId: oi2b },
  ] as any[]);

  // ── Order 3: confirmed (2 days ago) ─────────────────────────────────────

  const ord3Id = uuid();
  await db.insert(orders).values({
    id: ord3Id, customerId,
    status: 'confirmed',
    pickupAttempts: 0,
    createdAt: daysAgo(2), updatedAt: daysAgo(2),
  } as any);

  const oi3a = uuid(), oi3b = uuid(), oi3c = uuid();
  await db.insert(orderItems).values([
    { id: oi3a, orderId: ord3Id, productId: prodIds.speaker,    qty: 1, unitPrice: '59.95' },
    { id: oi3b, orderId: ord3Id, productId: prodIds.resistance, qty: 2, unitPrice: '27.00' },
    { id: oi3c, orderId: ord3Id, productId: prodIds.frenchPress,qty: 1, unitPrice: '39.95' },
  ] as any[]);

  await db.insert(tenderSplits).values([
    { id: uuid(), orderId: ord3Id, method: 'card', amount: '153.90', reference: 'TXN-CC-00534' },
  ] as any[]);

  const pg3Id = uuid();
  await db.insert(pickupGroups).values({
    id: pg3Id, orderId: ord3Id, department: 'warehouse', status: 'pending',
    createdAt: daysAgo(2), updatedAt: daysAgo(2),
  } as any);
  await db.insert(pickupGroupItems).values([
    { id: uuid(), pickupGroupId: pg3Id, orderItemId: oi3a },
    { id: uuid(), pickupGroupId: pg3Id, orderItemId: oi3b },
    { id: uuid(), pickupGroupId: pg3Id, orderItemId: oi3c },
  ] as any[]);

  // ── Order 4: pending (today) ─────────────────────────────────────────────

  const ord4Id = uuid();
  await db.insert(orders).values({
    id: ord4Id, customerId,
    status: 'pending',
    pickupAttempts: 0,
    createdAt: hoursAgo(2), updatedAt: hoursAgo(2),
  } as any);

  const oi4a = uuid();
  await db.insert(orderItems).values([
    { id: oi4a, orderId: ord4Id, productId: prodIds.backpack, qty: 1, unitPrice: '149.00' },
  ] as any[]);

  console.log('    inserted 4 orders');

  // ── Reviews ─────────────────────────────────────────────────────────────

  const rev1Id = uuid();
  await db.insert(reviews).values({
    id: rev1Id,
    orderId: ord1Id,
    customerId,
    body: 'The Meridian headphones are absolutely incredible. Sound quality is crystal clear and the noise-cancellation is top notch. Battery easily lasts 2 days of heavy use. The water bottle arrived perfectly packed too. Would order again without hesitation.',
    isFollowup: false,
    moderationStatus: 'approved',
    submittedAt: daysAgo(12),
  } as any);

  const rev2Id = uuid();
  await db.insert(reviews).values({
    id: rev2Id,
    orderId: ord1Id,
    customerId,
    body: 'Follow-up after a few more weeks of use — headphones still going strong. Battery performance has been consistent. The carrying case is holding up well. Very happy with this purchase.',
    isFollowup: true,
    parentReviewId: rev1Id,
    moderationStatus: 'approved',
    submittedAt: daysAgo(5),
  } as any);

  const rev3Id = uuid();
  await db.insert(reviews).values({
    id: rev3Id,
    orderId: ord3Id,
    customerId,
    body: 'Excited to pick up my speaker and resistance bands. The associate at the desk was really helpful in explaining the pickup process.',
    isFollowup: false,
    moderationStatus: 'pending',
    submittedAt: hoursAgo(4),
  } as any);

  console.log('    inserted 3 reviews');

  // ── After-sales tickets ─────────────────────────────────────────────────

  const tick1Id = uuid();
  await db.insert(afterSalesTickets).values({
    id: tick1Id,
    orderId: ord1Id,
    customerId,
    type: 'return',
    status: 'in_progress',
    department: 'front_desk',
    assignedTo: associateId,
    windowDays: 30,
    createdAt: daysAgo(10), updatedAt: daysAgo(8),
  } as any);

  await db.insert(ticketEvents).values([
    {
      id: uuid(), ticketId: tick1Id, actorId: customerId,
      eventType: 'checked_in',
      note: 'Customer reported one earcup has a slight rattle when turned up to max volume.',
      createdAt: daysAgo(10),
    },
    {
      id: uuid(), ticketId: tick1Id, actorId: associateId,
      eventType: 'triaged',
      note: 'Confirmed rattle on inspection. Escalating for warranty assessment.',
      nodeDurationMs: 8 * 60 * 1000,
      createdAt: daysAgo(9),
    },
    {
      id: uuid(), ticketId: tick1Id, actorId: supervisorId,
      eventType: 'reassigned',
      fromDept: 'front_desk', toDept: 'fulfillment',
      note: 'Routed to fulfilment for physical inspection and replacement assessment.',
      nodeDurationMs: 24 * 60 * 60 * 1000,
      createdAt: daysAgo(8),
    },
  ] as any[]);

  const tick2Id = uuid();
  await db.insert(afterSalesTickets).values({
    id: tick2Id,
    orderId: ord1Id,
    customerId,
    type: 'price_adjustment',
    status: 'resolved',
    department: 'accounting',
    assignedTo: managerId,
    receiptReference: 'REC-2024-00892',
    windowDays: 30,
    outcome: 'approved',
    resolvedAt: daysAgo(7),
    createdAt: daysAgo(11), updatedAt: daysAgo(7),
  } as any);

  await db.insert(ticketEvents).values([
    {
      id: uuid(), ticketId: tick2Id, actorId: customerId,
      eventType: 'checked_in',
      note: 'Customer noticed the headphones are on sale for $30 less. Requesting price adjustment.',
      createdAt: daysAgo(11),
    },
    {
      id: uuid(), ticketId: tick2Id, actorId: managerId,
      eventType: 'triaged',
      note: 'Price drop confirmed. Order within adjustment window. Approving $30 adjustment.',
      nodeDurationMs: 2 * 60 * 60 * 1000,
      createdAt: daysAgo(11),
    },
    {
      id: uuid(), ticketId: tick2Id, actorId: managerId,
      eventType: 'resolved',
      note: 'Price adjustment of $30.00 approved and processed to original payment card.',
      nodeDurationMs: 4 * 24 * 60 * 60 * 1000,
      createdAt: daysAgo(7),
    },
  ] as any[]);

  const tick3Id = uuid();
  await db.insert(afterSalesTickets).values({
    id: tick3Id,
    orderId: ord2Id,
    customerId,
    type: 'refund',
    status: 'open',
    department: 'front_desk',
    windowDays: 30,
    createdAt: hoursAgo(6), updatedAt: hoursAgo(6),
  } as any);

  await db.insert(ticketEvents).values([
    {
      id: uuid(), ticketId: tick3Id, actorId: customerId,
      eventType: 'checked_in',
      note: 'Smartwatch arrived but screen has a dead pixel in the bottom-right corner.',
      createdAt: hoursAgo(6),
    },
  ] as any[]);

  console.log('    inserted 3 tickets with events');

  // ── Notifications ───────────────────────────────────────────────────────

  await db.insert(notifications).values([
    {
      id: uuid(), customerId,
      message: 'Your order is ready for pickup! Show code 731-604 at the fulfillment desk.',
      entityType: 'order', entityId: ord2Id,
      isRead: false, createdAt: daysAgo(3),
    },
    {
      id: uuid(), customerId,
      message: 'Your return ticket has been updated — routed to fulfillment for inspection.',
      entityType: 'ticket', entityId: tick1Id,
      isRead: false, createdAt: daysAgo(8),
    },
    {
      id: uuid(), customerId,
      message: 'Your price adjustment of $30.00 has been approved and processed.',
      entityType: 'ticket', entityId: tick2Id,
      isRead: true, createdAt: daysAgo(7),
    },
    {
      id: uuid(), customerId,
      message: 'Your review has been approved and is now visible.',
      entityType: 'ticket', entityId: rev1Id,
      isRead: true, createdAt: daysAgo(11),
    },
  ] as any[]);

  console.log('    inserted 4 notifications');

  // ── Rules ───────────────────────────────────────────────────────────────

  await db.insert(rules).values([
    {
      id: uuid(),
      name: 'Gold Tier 10% Discount',
      version: 1,
      status: 'active',
      definitionJson: { type: 'discount', tier: 'gold', percent: 10, stackable: false },
      adminComment: 'Standard gold-tier loyalty discount applied at checkout.',
      createdBy: adminId,
      publishedAt: daysAgo(30),
    },
    {
      id: uuid(),
      name: 'Electronics Free Shipping',
      version: 1,
      status: 'active',
      definitionJson: { type: 'free_shipping', category: 'Electronics', minOrderCents: 10000 },
      adminComment: 'Free shipping on electronics orders over $100.',
      createdBy: adminId,
      publishedAt: daysAgo(20),
    },
    {
      id: uuid(),
      name: 'Weekend Flash 5% Off',
      version: 2,
      status: 'inactive',
      definitionJson: { type: 'discount', days: ['saturday', 'sunday'], percent: 5, stackable: true },
      adminComment: 'Weekend flash discount — paused pending review.',
      createdBy: managerId,
    },
  ] as any[]);

  console.log('    inserted 3 rules');

  // ── Banned terms ────────────────────────────────────────────────────────

  await db.insert(bannedTerms).values([
    { id: uuid(), term: 'scam',    isRegex: false, isActive: true, createdBy: adminId },
    { id: uuid(), term: 'fraud',   isRegex: false, isActive: true, createdBy: adminId },
    { id: uuid(), term: 'fake',    isRegex: false, isActive: true, createdBy: adminId },
    { id: uuid(), pattern: '\\b(buy|get)\\s+cheap\\b', isRegex: true, isActive: true, createdBy: adminId },
  ] as any[]);

  console.log('    inserted 4 banned terms');

  await client.end();
  console.log('==> Data seed complete.');
}

seed().catch((err) => {
  console.error('Data seed failed:', err);
  process.exit(1);
});
