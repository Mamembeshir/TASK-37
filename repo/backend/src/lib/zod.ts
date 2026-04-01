import { z } from 'zod';

// Re-export z so routes import from one place
export { z };

// ── Common parameter schemas ──────────────────────────────────────────────────

/** Route param containing a single UUID, e.g. /orders/:id */
export const uuidParam = z.object({
  id: z.string().uuid(),
});

// ── Common query schemas ──────────────────────────────────────────────────────

/** Standard cursor-style pagination query params */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Auth schemas ──────────────────────────────────────────────────────────────

/**
 * SPEC: "username/password authentication only (minimum 10 characters)."
 *
 * All routes that accept a password field MUST use this schema so the
 * constraint is enforced in one place and never duplicated.
 *
 * Used by: POST /auth/login, and any future POST /auth/register or
 *          POST /auth/change-password routes.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters');

// ── Common response schemas ───────────────────────────────────────────────────

/** Generic success envelope */
export const okResponse = z.object({
  ok: z.literal(true),
});

/** Generic error envelope (matches the shape returned by error-handler.ts) */
export const errorResponse = z.object({
  statusCode: z.number(),
  error: z.string(),
});
