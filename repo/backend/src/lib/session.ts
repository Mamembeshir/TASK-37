import { createHmac } from 'crypto';

/**
 * Compute HMAC-SHA256(SESSION_SECRET, rawToken).
 * This is the value stored in the `sessions.token_hash` column.
 * A DB compromise alone cannot replay tokens without the application secret.
 */
export function hashToken(rawToken: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is required');
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}
