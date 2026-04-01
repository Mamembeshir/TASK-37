/**
 * Role definitions for the Retail Operations Hub.
 *
 * Five roles ordered by privilege level (lowest → highest):
 *
 *  customer    — In-store kiosk / Wi-Fi shopper.
 *                Can: browse catalog, place orders, submit reviews, open after-sales tickets,
 *                read their own notifications, view their own order/ticket history.
 *                Cannot: access any staff console or other customers' data.
 *
 *  associate   — Front-line store staff.
 *                Can: everything a customer can (on behalf of a customer) PLUS verify pickup
 *                codes, check in returns at the counter, work triage questions, view ticket
 *                timelines, record tender splits.
 *                Cannot: extend refund windows, override pickup lockout, publish rules, manage
 *                products or campaigns.
 *
 *  supervisor  — Senior floor staff.
 *                Can: everything an associate can PLUS view cross-department ticket queues,
 *                reassign tickets between departments, approve moderation appeals.
 *                Cannot: override pickup lockout (manager only), extend refund beyond 30 days,
 *                publish/rollback rules, manage campaigns.
 *
 *  manager     — Store manager.
 *                Can: everything a supervisor can PLUS approve price adjustments, extend
 *                refund window to 60 days, provide manager-credential override when pickup
 *                attempts are exhausted (Q1), manage product catalog.
 *                Cannot: publish/rollback versioned rules, create A/B campaigns.
 *
 *  admin       — System administrator.
 *                Can: everything a manager can PLUS publish/rollback rules, create and toggle
 *                A/B recommendation campaigns, manage banned terms and image hashes, create
 *                and deactivate user accounts, view full audit logs.
 */

import type { User } from '../db/schema/users';

/** All valid role values, ordered lowest → highest privilege. */
export const ROLES = ['customer', 'associate', 'supervisor', 'manager', 'admin'] as const;

/** The union type of all role strings. */
export type Role = User['role'];

/**
 * Numeric privilege level for each role.
 * Used by isAtLeast() to check role hierarchy without enumerating every role.
 */
const ROLE_LEVEL: Record<Role, number> = {
  customer: 0,
  associate: 1,
  supervisor: 2,
  manager: 3,
  admin: 4,
};

/**
 * Returns true when `userRole` has privilege ≥ `minRole`.
 * Use this instead of direct equality checks when a route should be
 * accessible to a role AND all higher-privilege roles.
 *
 * @example
 *   isAtLeast('manager', user.role)  // true for manager + admin
 */
export function isAtLeast(minRole: Role, userRole: Role): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[minRole];
}

/**
 * Returns true when `userRole` is one of the provided roles.
 * Use this for exact membership checks (e.g. only supervisor OR admin,
 * not everyone in between).
 */
export function hasRole(userRole: Role, ...allowed: Role[]): boolean {
  return allowed.includes(userRole);
}

/**
 * Staff roles — any role that is NOT a customer.
 * Used by phone-masking and other staff-vs-customer gates.
 */
export const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([
  'associate',
  'supervisor',
  'manager',
  'admin',
]);

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.has(role);
}
