/**
 * Seed helpers for integration tests.
 * Each function inserts a minimal valid row and returns it.
 *
 * Example:
 *   const admin = await seedUser({ role: 'admin' });
 *   const product = await seedProduct({ stockQty: 10 });
 */

import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { testDb } from './db.js';
import { users, products } from '../db/schema/index.js';
import { carts, cartItems } from '../db/schema/carts.js';
import { orders, orderItems } from '../db/schema/orders.js';
import { tenderSplits } from '../db/schema/tender-splits.js';
import { bannedTerms } from '../db/schema/banned-terms.js';
import { reviews, reviewImages } from '../db/schema/reviews.js';
import { moderationFlags, moderationAppeals } from '../db/schema/moderation.js';
import { imageHashes } from '../db/schema/image-hashes.js';
import { rules, rulesHistory } from '../db/schema/rules.js';
import type { NewUser } from '../db/schema/users.js';
import type { RuleDefinition } from '@retail-hub/shared';

// ── Users ─────────────────────────────────────────────────────────────────────

type SeedUserOpts = Partial<Omit<NewUser, 'passwordHash'>> & {
  password?: string;
};

export async function seedUser(opts: SeedUserOpts = {}) {
  const {
    username = `user_${Date.now()}`,
    password = 'password1234',
    role = 'customer',
    ...rest
  } = opts;

  const passwordHash = await bcrypt.hash(password, 4); // low rounds for speed
  const [user] = await testDb
    .insert(users)
    .values({ username, passwordHash, role, ...rest })
    .returning();
  return user!;
}

// ── Products ──────────────────────────────────────────────────────────────────

type SeedProductOpts = {
  name?: string;
  description?: string;
  brand?: string;
  price?: string;
  stockQty?: number;
  category?: string;
  isActive?: boolean;
};

export async function seedProduct(opts: SeedProductOpts = {}) {
  const {
    name = `Product ${Date.now()}`,
    description = 'Test product',
    brand = 'TestBrand',
    price = '9.99',
    stockQty = 100,
    category = 'general',
    isActive = true,
  } = opts;

  const [product] = await testDb
    .insert(products)
    .values({ name, description, brand, price, stockQty, category, isActive })
    .returning();
  return product!;
}

// ── Carts ─────────────────────────────────────────────────────────────────────

export async function seedCart(opts: {
  customerId: string;
  status?: 'active' | 'expired' | 'cancelled' | 'converted';
  expiresAt?: Date;
}) {
  const {
    customerId,
    status = 'active',
    expiresAt = new Date(Date.now() + 30 * 60 * 1000),
  } = opts;
  const [cart] = await testDb
    .insert(carts)
    .values({ customerId, status, expiresAt })
    .returning();
  return cart!;
}

export async function seedCartItem(opts: {
  cartId: string;
  productId: string;
  qty?: number;
}) {
  const { cartId, productId, qty = 1 } = opts;
  const [item] = await testDb
    .insert(cartItems)
    .values({ cartId, productId, qty })
    .returning();
  return item!;
}

// ── Orders ────────────────────────────────────────────────────────────────────

export async function seedOrder(opts: {
  customerId: string;
  status?: 'pending' | 'confirmed' | 'ready_for_pickup' | 'pickup_locked' | 'picked_up' | 'cancelled';
  /** bcrypt hash of the pickup code (NOT the plaintext). */
  pickupCode?: string;
  /** SHA-256 hex of the plaintext pickup code. */
  pickupCodeIndex?: string;
  pickupAttempts?: number;
}) {
  const { customerId, status = 'pending', pickupCode, pickupCodeIndex, pickupAttempts = 0 } = opts;
  const [order] = await testDb
    .insert(orders)
    .values({ customerId, status, pickupCode, pickupCodeIndex, pickupAttempts })
    .returning();
  return order!;
}

/**
 * Convenience: seed an order pre-loaded with a known plaintext pickup code.
 * Returns the order row AND the plaintext code for use in verify tests.
 */
export async function seedOrderWithCode(opts: {
  customerId: string;
  status?: 'ready_for_pickup' | 'pickup_locked';
  pickupCodePlain?: string;
  pickupAttempts?: number;
}) {
  const {
    customerId,
    status = 'ready_for_pickup',
    pickupCodePlain = '123456',
    pickupAttempts = 0,
  } = opts;
  const pickupCode = await bcrypt.hash(pickupCodePlain, 4);
  const pickupCodeIndex = createHash('sha256').update(pickupCodePlain).digest('hex');
  const order = await seedOrder({ customerId, status, pickupCode, pickupCodeIndex, pickupAttempts });
  return { order, pickupCodePlain };
}

export async function seedOrderItem(opts: {
  orderId: string;
  productId: string;
  qty?: number;
  unitPrice?: string;
}) {
  const { orderId, productId, qty = 1, unitPrice = '9.99' } = opts;
  const [item] = await testDb
    .insert(orderItems)
    .values({ orderId, productId, qty, unitPrice })
    .returning();
  return item!;
}

export async function seedTenderSplit(opts: {
  orderId: string;
  method: 'cash' | 'card';
  amount: string;
  reference?: string | null;
}) {
  const { orderId, method, amount, reference } = opts;
  const [split] = await testDb
    .insert(tenderSplits)
    .values({ orderId, method, amount, reference: reference ?? undefined })
    .returning();
  return split!;
}

// ── Reviews & Moderation ──────────────────────────────────────────────────────

export async function seedBannedTerm(opts: {
  term?: string | null;
  pattern?: string | null;
  isRegex?: boolean;
  isActive?: boolean;
  createdBy: string;
}) {
  const { term = null, pattern = null, isRegex = false, isActive = true, createdBy } = opts;
  const [bt] = await testDb
    .insert(bannedTerms)
    .values({ term: term ?? undefined, pattern: pattern ?? undefined, isRegex, isActive, createdBy })
    .returning();
  return bt!;
}

export async function seedReview(opts: {
  orderId: string;
  customerId: string;
  body?: string;
  isFollowup?: boolean;
  parentReviewId?: string | null;
  moderationStatus?: 'pending' | 'approved' | 'flagged';
}) {
  const {
    orderId,
    customerId,
    body = 'Great product!',
    isFollowup = false,
    parentReviewId = null,
    moderationStatus = 'pending',
  } = opts;
  const [review] = await testDb
    .insert(reviews)
    .values({
      orderId,
      customerId,
      body,
      isFollowup,
      parentReviewId: parentReviewId ?? undefined,
      moderationStatus,
    })
    .returning();
  return review!;
}

export async function seedReviewImage(opts: {
  reviewId: string;
  originalName?: string;
  storagePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
}) {
  const {
    reviewId,
    originalName = 'test.jpg',
    storagePath = `/tmp/test_${Date.now()}.jpg`,
    mimeType = 'image/jpeg',
    sizeBytes = 1024,
    sha256 = createHash('sha256').update(`img_${Date.now()}_${Math.random()}`).digest('hex'),
  } = opts;
  const [img] = await testDb
    .insert(reviewImages)
    .values({ reviewId, originalName, storagePath, mimeType, sizeBytes, sha256 })
    .returning();
  return img!;
}

export async function seedModerationFlag(opts: {
  entityType: 'review' | 'review_image';
  entityId: string;
  source?: 'auto' | 'user_report';
  reason?: string;
  status?: 'pending' | 'resolved_approved' | 'resolved_rejected';
  reportedBy?: string | null;
}) {
  const {
    entityType,
    entityId,
    source = 'auto',
    reason = 'Test flag',
    status = 'pending',
    reportedBy = null,
  } = opts;
  const [flag] = await testDb
    .insert(moderationFlags)
    .values({
      entityType,
      entityId,
      source,
      reason,
      status,
      reportedBy: reportedBy ?? undefined,
    })
    .returning();
  return flag!;
}

export async function seedModerationAppeal(opts: {
  flagId: string;
  submittedBy: string;
  reason?: string;
  status?: 'pending' | 'approved' | 'rejected';
}) {
  const { flagId, submittedBy, reason = 'Please reconsider', status = 'pending' } = opts;
  const [appeal] = await testDb
    .insert(moderationAppeals)
    .values({ flagId, submittedBy, reason, status })
    .returning();
  return appeal!;
}

export async function seedImageHash(opts: { sha256: string; flaggedBy: string }) {
  const { sha256, flaggedBy } = opts;
  const [hash] = await testDb
    .insert(imageHashes)
    .values({ sha256, flaggedBy })
    .returning();
  return hash!;
}

/** Minimal valid JPEG buffer (magic bytes + padding). */
export const VALID_JPEG_BUFFER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(16, 0),
]);

/** Minimal valid PNG buffer (magic bytes + padding). */
export const VALID_PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 0),
]);

/**
 * Build a multipart/form-data body buffer for use with app.inject().
 * Supports text fields and file parts.
 */
export function buildMultipart(opts: {
  fields?: Record<string, string>;
  files?: { fieldname: string; filename: string; mimetype: string; buffer: Buffer }[];
}): { body: Buffer; contentType: string } {
  const { fields = {}, files = [] } = opts;
  const boundary = `----TestBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  for (const file of files) {
    parts.push(
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.mimetype}\r\n\r\n`,
        ),
        file.buffer,
        Buffer.from('\r\n'),
      ]),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/** Minimal valid rule definition usable as a default in seed helpers. */
export const MINIMAL_RULE_DEF: RuleDefinition = {
  evaluation_mode: 'parallel',
  priority: 100,
  conditions: { type: 'leaf', field: 'flag', operator: 'eq', value: true },
  actions: [{ type: 'allow', params: {} }],
};

export async function seedRule(opts: {
  name?: string;
  status?: 'draft' | 'active' | 'inactive' | 'rolled_back';
  version?: number;
  definitionJson?: RuleDefinition;
  adminComment?: string;
  createdBy: string;
  publishedAt?: Date | null;
}) {
  const {
    name = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status = 'draft',
    version = 1,
    definitionJson = MINIMAL_RULE_DEF,
    adminComment = 'Initial version',
    createdBy,
    publishedAt = status === 'active' ? new Date() : null,
  } = opts;
  const [rule] = await testDb
    .insert(rules)
    .values({
      name,
      status,
      version,
      definitionJson,
      adminComment,
      createdBy,
      publishedAt: publishedAt ?? undefined,
    })
    .returning();
  return rule!;
}

export async function seedRuleHistory(opts: {
  ruleId: string;
  version?: number;
  status?: 'draft' | 'active' | 'inactive' | 'rolled_back';
  definitionJson?: RuleDefinition;
  adminComment?: string;
  createdBy: string;
  publishedAt?: Date | null;
}) {
  const {
    ruleId,
    version = 1,
    status = 'active',
    definitionJson = MINIMAL_RULE_DEF,
    adminComment = 'Archived version',
    createdBy,
    publishedAt = status === 'active' ? new Date() : null,
  } = opts;
  const [hist] = await testDb
    .insert(rulesHistory)
    .values({
      ruleId,
      version,
      status,
      definitionJson,
      adminComment,
      createdBy,
      publishedAt: publishedAt ?? undefined,
    })
    .returning();
  return hist!;
}

// ── Tickets & Notifications ───────────────────────────────────────────────────

import { afterSalesTickets } from '../db/schema/after-sales-tickets.js';
import { ticketEvents } from '../db/schema/ticket-events.js';
import { notifications } from '../db/schema/notifications.js';
import { encryptNullable } from '../lib/crypto.js';

export async function seedTicket(opts: {
  orderId: string;
  customerId: string;
  type?: 'return' | 'refund' | 'price_adjustment';
  status?: 'open' | 'in_progress' | 'pending_inspection' | 'resolved' | 'cancelled';
  department?: 'front_desk' | 'fulfillment' | 'accounting';
  assignedTo?: string | null;
  receiptReference?: string | null;
  windowDays?: number;
  outcome?: 'approved' | 'rejected' | 'adjusted' | null;
}) {
  const {
    orderId,
    customerId,
    type = 'return',
    status = 'open',
    department = 'fulfillment',
    assignedTo = null,
    receiptReference = null,
    windowDays = 30,
    outcome = null,
  } = opts;
  const [ticket] = await testDb
    .insert(afterSalesTickets)
    .values({
      orderId,
      customerId,
      type,
      status,
      department,
      assignedTo: assignedTo ?? undefined,
      receiptReference: receiptReference ?? undefined,
      windowDays,
      outcome: outcome ?? undefined,
    })
    .returning();
  return ticket!;
}

export async function seedTicketEvent(opts: {
  ticketId: string;
  actorId: string;
  eventType: 'checked_in' | 'triaged' | 'reassigned' | 'interrupted' | 'note_added' | 'resolved' | 'cancelled';
  note?: string | null;
  fromDept?: 'front_desk' | 'fulfillment' | 'accounting' | null;
  toDept?: 'front_desk' | 'fulfillment' | 'accounting' | null;
  nodeDurationMs?: number | null;
}) {
  const { ticketId, actorId, eventType, note = null, fromDept = null, toDept = null, nodeDurationMs = null } = opts;
  const [event] = await testDb
    .insert(ticketEvents)
    .values({
      ticketId,
      actorId,
      eventType,
      note: encryptNullable(note),
      fromDept: fromDept ?? undefined,
      toDept: toDept ?? undefined,
      nodeDurationMs: nodeDurationMs ?? undefined,
    })
    .returning();
  return event!;
}

export async function seedNotification(opts: {
  customerId: string;
  message?: string;
  entityType?: string | null;
  entityId?: string | null;
  isRead?: boolean;
}) {
  const { customerId, message = 'Test notification', entityType = null, entityId = null, isRead = false } = opts;
  const [notification] = await testDb
    .insert(notifications)
    .values({
      customerId,
      message,
      entityType: entityType ?? undefined,
      entityId: entityId ?? undefined,
      isRead,
    })
    .returning();
  return notification!;
}
