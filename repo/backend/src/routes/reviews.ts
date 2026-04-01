import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { z, uuidParam } from '../lib/zod';
import { reviews, reviewImages, type ReviewImage } from '../db/schema/reviews';
import { orders } from '../db/schema/orders';
import { imageHashes } from '../db/schema/image-hashes';
import { runModerationScan } from '../lib/moderation';
import { auditLogs } from '../db/schema/audit-logs';
import { sendError } from '../lib/reply';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 5_242_880; // 5 MB — per SPEC and Q15
const MAX_IMAGES = 6;             // per SPEC and Q15
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png']);

/** UPLOAD_DIR is configured via env var; defaults to local ./uploads */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

/** 14-day window for follow-up reviews (Q4 confirmed). */
const FOLLOWUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validate file content matches the declared MIME type using magic bytes.
 * JPEG: FF D8 FF | PNG: 89 50 4E 47 0D 0A 1A 0A
 */
function hasValidMagicBytes(buffer: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a &&
      buffer[6] === 0x1a && buffer[7] === 0x0a
    );
  }
  return false;
}

type RawImage = { filename: string; mimetype: string; buffer: Buffer };
type ValidatedImage = RawImage & { sha256: string };

/**
 * Validate all images: count, size, MIME type, magic bytes, and SHA-256
 * blocklist.  Returns validated images with sha256 pre-computed.
 * Throws { status, message } on any validation failure.
 */
async function validateImages(
  images: RawImage[],
  db: FastifyInstance['db'],
): Promise<ValidatedImage[]> {
  if (images.length > MAX_IMAGES) {
    throw { status: 400, message: `Maximum ${MAX_IMAGES} images per review.` };
  }

  const result: ValidatedImage[] = [];

  for (const img of images) {
    // Size (task 88) — double-check even though multipart plugin also limits
    if (img.buffer.byteLength > MAX_IMAGE_SIZE) {
      throw {
        status: 400,
        message: `Image '${img.filename}' exceeds the 5 MB size limit (${img.buffer.byteLength} bytes).`,
      };
    }

    // MIME type (task 88)
    if (!ALLOWED_MIMES.has(img.mimetype)) {
      throw {
        status: 400,
        message: `Image '${img.filename}': only JPEG and PNG are accepted (got '${img.mimetype}').`,
      };
    }

    // Magic bytes — defends against spoofed Content-Type headers (task 88)
    if (!hasValidMagicBytes(img.buffer, img.mimetype)) {
      throw {
        status: 400,
        message: `Image '${img.filename}': file content does not match the declared MIME type '${img.mimetype}'.`,
      };
    }

    // SHA-256 hash (task 89)
    const sha256 = createHash('sha256').update(img.buffer).digest('hex');

    // Blocklist check (task 89)
    const [blocked] = await db
      .select({ id: imageHashes.id })
      .from(imageHashes)
      .where(eq(imageHashes.sha256, sha256))
      .limit(1);

    if (blocked) {
      throw {
        status: 400,
        message: `Image '${img.filename}' has been flagged and cannot be uploaded.`,
      };
    }

    result.push({ ...img, sha256 });
  }

  return result;
}

/**
 * Write validated image buffers to disk under UPLOAD_DIR/reviews/{reviewId}/
 * and return the DB-ready row payloads (without reviewId).
 */
async function saveImages(
  images: ValidatedImage[],
  reviewId: string,
): Promise<{ originalName: string; storagePath: string; mimeType: string; sizeBytes: number; sha256: string }[]> {
  if (images.length === 0) return [];

  const dir = join(UPLOAD_DIR, 'reviews', reviewId);
  await mkdir(dir, { recursive: true });

  return Promise.all(
    images.map(async (img) => {
      const ext = extname(img.filename) || (img.mimetype === 'image/jpeg' ? '.jpg' : '.png');
      const storagePath = join(dir, `${randomUUID()}${ext}`);
      await writeFile(storagePath, img.buffer);
      return {
        originalName: img.filename,
        storagePath,
        mimeType: img.mimetype,
        sizeBytes: img.buffer.byteLength,
        sha256: img.sha256,
      };
    }),
  );
}

/** Read all parts from a multipart request and split into fields and files. */
async function parseMultipart(req: FastifyRequest) {
  let bodyText: string | undefined;
  let orderIdField: string | undefined;
  const imageFiles: RawImage[] = [];

  for await (const part of req.parts()) {
    if (part.type === 'field') {
      const val = part.value as string;
      if (part.fieldname === 'body') bodyText = val;
      if (part.fieldname === 'orderId') orderIdField = val;
    } else {
      // File part
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk);
      imageFiles.push({
        filename: part.filename ?? 'upload',
        mimetype: part.mimetype,
        buffer: Buffer.concat(chunks),
      });
    }
  }

  return { bodyText, orderIdField, imageFiles };
}

// ── Response schemas ──────────────────────────────────────────────────────────

const reviewImageOut = z.object({
  id: z.string().uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  uploadedAt: z.string(),
});

const reviewOut = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  customerId: z.string().uuid(),
  body: z.string(),
  isFollowup: z.boolean(),
  parentReviewId: z.string().uuid().nullable(),
  moderationStatus: z.string(),
  submittedAt: z.string(),
  images: z.array(reviewImageOut),
});

// ── Route plugin ──────────────────────────────────────────────────────────────

async function reviewRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /reviews
   *
   * Submit a review for a picked-up order.
   * Content-Type: multipart/form-data
   *   - body    (text field, required): review text
   *   - orderId (text field, required): UUID of the picked-up order
   *   - images  (file fields, optional): up to 6 JPEG/PNG files, each ≤ 5 MB
   *
   * Tasks 86–89:
   *   86. Creates review linked to order
   *   87. Enforces max 6 images
   *   88. Validates MIME type (JPEG/PNG only), magic bytes, and size ≤ 5 MB
   *   89. Computes SHA-256 of each image; rejects if hash is in image_hashes blocklist
   *
   * Only the order's customer may submit. Order must be 'picked_up'.
   * At most one original review per order (follow-ups use POST /reviews/:id/followup).
   * New reviews start with moderationStatus = 'pending' (task 93 runs offline scan).
   */
  app.post(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: { response: { 201: reviewOut } },
    },
    async (req, reply) => {
      const customerId = req.user!.id;

      const { bodyText, orderIdField, imageFiles } = await (async () => {
        let bodyText: string | undefined;
        let orderIdField: string | undefined;
        const imageFiles: RawImage[] = [];
        for await (const part of req.parts()) {
          if (part.type === 'field') {
            const val = part.value as string;
            if (part.fieldname === 'body') bodyText = val;
            if (part.fieldname === 'orderId') orderIdField = val;
          } else {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            imageFiles.push({ filename: part.filename ?? 'upload', mimetype: part.mimetype, buffer: Buffer.concat(chunks) });
          }
        }
        return { bodyText, orderIdField, imageFiles };
      })();

      if (!bodyText?.trim()) {
        return sendError(reply, 400, 'Review body is required.');
      }
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!orderIdField || !uuidRe.test(orderIdField)) {
        return sendError(reply, 400, 'A valid orderId UUID is required.');
      }

      const [order] = await app.db
        .select({ id: orders.id, customerId: orders.customerId, status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderIdField))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }
      if (order.customerId !== customerId) {
        return sendError(reply, 403, 'You can only review your own orders.');
      }
      if (order.status !== 'picked_up') {
        return sendError(reply, 409, 'Reviews can only be submitted for picked-up orders.');
      }

      const [existing] = await app.db
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.orderId, orderIdField), eq(reviews.isFollowup, false)))
        .limit(1);

      if (existing) {
        return sendError(reply, 409, 'A review already exists for this order. Use POST /reviews/:id/followup for a follow-up.');
      }

      let validatedImages: ValidatedImage[];
      try {
        validatedImages = await validateImages(imageFiles, app.db);
      } catch (e: any) {
        return sendError(reply, e.status ?? 400, e.message);
      }

      // New reviews start pending for offline moderation scan.
      const [review] = await app.db
        .insert(reviews)
        .values({ orderId: orderIdField, customerId, body: bodyText.trim(), isFollowup: false })
        .returning();

      const imageMeta = await saveImages(validatedImages, review.id);
      const insertedImages =
        imageMeta.length > 0
          ? await app.db
              .insert(reviewImages)
              .values(imageMeta.map((m) => ({ reviewId: review.id, ...m })))
              .returning()
          : [];

      await runModerationScan(
        app.db,
        review.id,
        review.body,
        insertedImages.map((i) => ({ id: i.id, sha256: i.sha256 })),
      );

      await app.db.insert(auditLogs).values({
        actorId: customerId,
        action: 'review.created',
        entityType: 'review',
        entityId: review.id,
        before: null,
        after: { orderId: review.orderId, imageCount: insertedImages.length, moderationStatus: review.moderationStatus },
      });

      return reply.status(201).send({
        id: review.id,
        orderId: review.orderId,
        customerId: review.customerId,
        body: review.body,
        isFollowup: review.isFollowup,
        parentReviewId: review.parentReviewId ?? null,
        moderationStatus: review.moderationStatus,
        submittedAt: review.submittedAt.toISOString(),
        images: insertedImages.map((i) => ({
          id: i.id,
          originalName: i.originalName,
          mimeType: i.mimeType,
          sizeBytes: i.sizeBytes,
          sha256: i.sha256,
          uploadedAt: i.uploadedAt.toISOString(),
        })),
      });
    },
  );

  /**
   * POST /reviews/:id/followup
   *
   * Submit a follow-up review for an existing original review.
   * Content-Type: multipart/form-data
   *   - body   (text field, required): follow-up review text
   *   - images (file fields, optional): up to 6 images (same constraints as original)
   *
   * Tasks 90–91:
   *   90. Creates follow-up linked to parent review's order
   *   91. Enforces exactly one follow-up per original; rejects if > 14 days since original
   *
   * Same image validation rules apply (tasks 87–89).
   */
  app.post(
    '/:id/followup',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: uuidParam,
        response: { 201: reviewOut },
      },
    },
    async (req, reply) => {
      const customerId = req.user!.id;
      const { id: parentId } = req.params;

      // 1. Parse multipart
      let bodyText: string | undefined;
      const imageFiles: RawImage[] = [];
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'body') bodyText = part.value as string;
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk);
          imageFiles.push({ filename: part.filename ?? 'upload', mimetype: part.mimetype, buffer: Buffer.concat(chunks) });
        }
      }

      if (!bodyText?.trim()) {
        return sendError(reply, 400, 'Follow-up body is required.');
      }

      const [parent] = await app.db
        .select({
          id: reviews.id,
          orderId: reviews.orderId,
          customerId: reviews.customerId,
          isFollowup: reviews.isFollowup,
          submittedAt: reviews.submittedAt,
        })
        .from(reviews)
        .where(eq(reviews.id, parentId))
        .limit(1);

      if (!parent) {
        return sendError(reply, 404, 'Original review not found.');
      }
      if (parent.isFollowup) {
        return sendError(reply, 400, 'Cannot follow up on a follow-up review.');
      }
      if (parent.customerId !== customerId) {
        return sendError(reply, 403, 'You can only follow up on your own reviews.');
      }

      // Enforce 14-day window (Q4: exactly one follow-up within 14 days).
      const ageMs = Date.now() - parent.submittedAt.getTime();
      if (ageMs > FOLLOWUP_WINDOW_MS) {
        return sendError(reply, 409, 'The 14-day window for follow-up reviews has expired.');
      }

      const [existingFollowup] = await app.db
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.parentReviewId, parentId))
        .limit(1);

      if (existingFollowup) {
        return sendError(reply, 409, 'A follow-up review has already been submitted for this review.');
      }

      let validatedImages: ValidatedImage[];
      try {
        validatedImages = await validateImages(imageFiles, app.db);
      } catch (e: any) {
        return sendError(reply, e.status ?? 400, e.message);
      }

      const [review] = await app.db
        .insert(reviews)
        .values({
          orderId: parent.orderId,
          customerId,
          body: bodyText.trim(),
          isFollowup: true,
          parentReviewId: parentId,
        })
        .returning();

      const imageMeta = await saveImages(validatedImages, review.id);
      const insertedImages =
        imageMeta.length > 0
          ? await app.db
              .insert(reviewImages)
              .values(imageMeta.map((m) => ({ reviewId: review.id, ...m })))
              .returning()
          : [];

      await runModerationScan(
        app.db,
        review.id,
        review.body,
        insertedImages.map((i) => ({ id: i.id, sha256: i.sha256 })),
      );

      await app.db.insert(auditLogs).values({
        actorId: customerId,
        action: 'review.followup_created',
        entityType: 'review',
        entityId: review.id,
        before: null,
        after: { parentReviewId: review.parentReviewId, orderId: review.orderId, imageCount: insertedImages.length, moderationStatus: review.moderationStatus },
      });

      return reply.status(201).send({
        id: review.id,
        orderId: review.orderId,
        customerId: review.customerId,
        body: review.body,
        isFollowup: review.isFollowup,
        parentReviewId: review.parentReviewId ?? null,
        moderationStatus: review.moderationStatus,
        submittedAt: review.submittedAt.toISOString(),
        images: insertedImages.map((i) => ({
          id: i.id,
          originalName: i.originalName,
          mimeType: i.mimeType,
          sizeBytes: i.sizeBytes,
          sha256: i.sha256,
          uploadedAt: i.uploadedAt.toISOString(),
        })),
      });
    },
  );

  /**
   * GET /reviews?orderId=
   *
   * List all reviews (original + follow-ups) for an order, with their images.
   *
   * Task 92.
   *
   * Authorization:
   *   - Customers may only list reviews for their own orders.
   *   - Staff may list reviews for any order.
   */
  app.get(
    '/',
    {
      preHandler: [app.requireAuth],
      schema: {
        querystring: z.object({ orderId: z.string().uuid() }),
        response: { 200: z.array(reviewOut) },
      },
    },
    async (req, reply) => {
      const { orderId } = req.query;
      const requestingUser = req.user!;
      const isStaff = ['associate', 'supervisor', 'manager', 'admin'].includes(requestingUser.role);

      const [order] = await app.db
        .select({ id: orders.id, customerId: orders.customerId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) {
        return sendError(reply, 404, 'Order not found.');
      }
      if (!isStaff && order.customerId !== requestingUser.id) {
        return sendError(reply, 403, 'Access denied.');
      }

      const reviewRows = await app.db
        .select()
        .from(reviews)
        .where(eq(reviews.orderId, orderId));

      if (reviewRows.length === 0) {
        return reply.send([]);
      }

      const reviewIds = reviewRows.map((r) => r.id);
      const imagesByReview = new Map<string, ReviewImage[]>();
      for (const rid of reviewIds) {
        const imgs = await app.db
          .select()
          .from(reviewImages)
          .where(eq(reviewImages.reviewId, rid));
        imagesByReview.set(rid, imgs);
      }

      return reply.send(
        reviewRows.map((r) => {
          const imgs = imagesByReview.get(r.id) ?? [];
          return {
            id: r.id,
            orderId: r.orderId,
            customerId: r.customerId,
            body: r.body,
            isFollowup: r.isFollowup,
            parentReviewId: r.parentReviewId ?? null,
            moderationStatus: r.moderationStatus,
            submittedAt: r.submittedAt.toISOString(),
            images: imgs.map((i) => ({
              id: i.id,
              originalName: i.originalName,
              mimeType: i.mimeType,
              sizeBytes: i.sizeBytes,
              sha256: i.sha256,
              uploadedAt: i.uploadedAt.toISOString(),
            })),
          };
        }),
      );
    },
  );
}

export default reviewRoutes;
