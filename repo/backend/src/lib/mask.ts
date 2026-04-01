/**
 * Phone masking helpers and safe user DTO builder.
 *
 * SPEC: "masking of customer phone numbers in staff views."
 * Staff roles (associate / supervisor / manager / admin) must never see a
 * customer's full phone number.  Customers viewing their own data see it
 * in full.
 *
 * Phone mask format: keep last 4 digits, replace everything else with *.
 * e.g.  "+1-555-867-5309"  →  "***********5309"
 *       null / undefined   →  null  (no phone on record)
 *
 * USAGE — every route that returns user/customer data to staff MUST go through
 * toUserView(user, viewerRole) rather than spreading the raw DB row. This
 * guarantees that:
 *   1. passwordHash, failedAttempts, lockedUntil are never sent over the wire.
 *   2. phone is masked whenever the viewer is a staff role.
 *
 * Example:
 *   // Staff viewing a customer:
 *   return toUserView(customer, req.user!.role);  // phone masked
 *
 *   // Customer viewing own profile:
 *   return toUserView(self, self.role);            // phone in full
 */

import type { User } from '../db/schema/users';
import type { Role } from './roles';
import { isStaff } from './roles';

/** @deprecated Use isStaff() from lib/roles instead. */
export function isStaffRole(role: Role): boolean {
  return isStaff(role);
}

/**
 * Mask a phone string, showing only the last 4 characters.
 * Returns null as-is (no phone stored).
 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const visible = phone.slice(-4);
  return '*'.repeat(Math.max(0, phone.length - 4)) + visible;
}

/**
 * Return the phone value appropriate for `viewerRole`.
 * Staff see a masked value; customers (and self-view with matching id) see full.
 */
export function phoneForViewer(
  phone: string | null,
  viewerRole: Role,
): string | null {
  return isStaff(viewerRole) ? maskPhone(phone) : phone;
}

/**
 * Safe user shape for API responses.
 * Strips all internal/sensitive fields; phone is masked for staff viewers.
 */
export type UserView = {
  id: string;
  username: string;
  role: Role;
  phone: string | null;
  createdAt: string; // ISO-8601
};

/**
 * Convert a raw user DB row into a response-safe UserView.
 *
 * @param user      - DB row (or any object with the required fields)
 * @param viewerRole - Role of the person making the request (from req.user.role
 *                    for protected routes, or the user's own role for self-view)
 *
 * Guarantees:
 *   - passwordHash is never included
 *   - failedAttempts is never included
 *   - lockedUntil is never included
 *   - phone is masked when viewerRole is a staff role
 */
export function toUserView(
  user: Pick<User, 'id' | 'username' | 'role' | 'phone' | 'createdAt'>,
  viewerRole: Role,
): UserView {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    phone: phoneForViewer(user.phone ?? null, viewerRole),
    createdAt: user.createdAt.toISOString(),
  };
}
