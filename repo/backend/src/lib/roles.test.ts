/**
 * Unit tests for RBAC role helpers.
 * Covers the privilege hierarchy, staff flag, and membership checks.
 */

import { describe, it, expect } from 'vitest';
import { isAtLeast, hasRole, isStaff, ROLES } from './roles.js';
import type { Role } from './roles.js';

// ── isAtLeast ──────────────────────────────────────────────────────────────────

describe('isAtLeast', () => {
  it('every role satisfies isAtLeast(itself)', () => {
    for (const role of ROLES) {
      expect(isAtLeast(role, role)).toBe(true);
    }
  });

  it('higher-privilege roles satisfy lower minRole thresholds', () => {
    expect(isAtLeast('customer', 'admin')).toBe(true);
    expect(isAtLeast('associate', 'supervisor')).toBe(true);
    expect(isAtLeast('associate', 'manager')).toBe(true);
    expect(isAtLeast('manager', 'admin')).toBe(true);
  });

  it('lower-privilege roles do NOT satisfy higher minRole thresholds', () => {
    expect(isAtLeast('admin', 'customer')).toBe(false);
    expect(isAtLeast('manager', 'customer')).toBe(false);
    expect(isAtLeast('manager', 'associate')).toBe(false);
    expect(isAtLeast('supervisor', 'customer')).toBe(false);
    expect(isAtLeast('admin', 'manager')).toBe(false);
  });

  it('full privilege ladder is ordered correctly', () => {
    const ordered: Role[] = ['customer', 'associate', 'supervisor', 'manager', 'admin'];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        // userRole (ordered[i]) satisfies minRole (ordered[j]) only when i >= j
        expect(isAtLeast(ordered[j]!, ordered[i]!)).toBe(i >= j);
      }
    }
  });
});

// ── hasRole ────────────────────────────────────────────────────────────────────

describe('hasRole', () => {
  it('returns true when the role is in the allowed list', () => {
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('manager', 'manager', 'admin')).toBe(true);
    expect(hasRole('supervisor', 'associate', 'supervisor')).toBe(true);
  });

  it('returns false when the role is not in the allowed list', () => {
    expect(hasRole('customer', 'admin')).toBe(false);
    expect(hasRole('associate', 'manager', 'admin')).toBe(false);
    // hasRole does NOT imply hierarchy — supervisor is not in ['manager', 'admin']
    expect(hasRole('supervisor', 'manager', 'admin')).toBe(false);
  });

  it('returns false with empty allowed list', () => {
    expect(hasRole('admin')).toBe(false);
  });

  it('matches exact role, not hierarchy (manager does not match [admin] alone)', () => {
    expect(hasRole('manager', 'admin')).toBe(false);
  });
});

// ── isStaff ────────────────────────────────────────────────────────────────────

describe('isStaff', () => {
  it('returns false for customer', () => {
    expect(isStaff('customer')).toBe(false);
  });

  it.each<Role>(['associate', 'supervisor', 'manager', 'admin'])(
    'returns true for staff role: %s',
    (role) => {
      expect(isStaff(role)).toBe(true);
    },
  );
});
