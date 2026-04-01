/**
 * Unit tests for phone masking helpers and toUserView().
 * No database or network connections needed.
 */

import { describe, it, expect } from 'vitest';
import { maskPhone, phoneForViewer, toUserView } from './mask.js';
import type { Role } from './roles.js';

// ── maskPhone ──────────────────────────────────────────────────────────────────

describe('maskPhone', () => {
  it('keeps last 4 digits, replaces the rest with asterisks', () => {
    // '+15558675309' is 12 chars → 8 asterisks + '5309'
    expect(maskPhone('+15558675309')).toBe('********5309');
  });

  it('handles exactly 4 chars — nothing to mask', () => {
    expect(maskPhone('1234')).toBe('1234');
  });

  it('handles fewer than 4 chars — returns full string (no negative padding)', () => {
    expect(maskPhone('123')).toBe('123');
  });

  it('returns null for empty string (treated as "no phone")', () => {
    // Empty string is falsy — the implementation treats it like null.
    expect(maskPhone('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(maskPhone(null)).toBeNull();
  });

  it('masks international format with dashes', () => {
    expect(maskPhone('+1-555-867-5309')).toBe('***********5309');
  });

  it('masks plain 10-digit number', () => {
    expect(maskPhone('5558675309')).toBe('******5309');
  });
});

// ── phoneForViewer ─────────────────────────────────────────────────────────────

describe('phoneForViewer', () => {
  const phone = '+15558675309';

  it('returns full phone for customer role (self-view)', () => {
    expect(phoneForViewer(phone, 'customer')).toBe(phone);
  });

  it.each<Role>(['associate', 'supervisor', 'manager', 'admin'])(
    'masks phone for staff role: %s',
    (role) => {
      const result = phoneForViewer(phone, role);
      expect(result).toBe('********5309');
      expect(result).not.toBe(phone);
    },
  );

  it('propagates null for all roles', () => {
    for (const role of ['customer', 'associate', 'manager', 'admin'] as Role[]) {
      expect(phoneForViewer(null, role)).toBeNull();
    }
  });
});

// ── toUserView ─────────────────────────────────────────────────────────────────

describe('toUserView', () => {
  const baseUser = {
    id: 'uuid-1',
    username: 'alice',
    role: 'customer' as Role,
    phone: '+15558675309',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    // Sensitive fields that must NEVER appear in output:
    passwordHash: '$2b$10$hashedpassword',
    failedAttempts: 3,
    lockedUntil: new Date('2025-01-01T00:15:00Z'),
  };

  it('returns required fields: id, username, role, phone, createdAt', () => {
    const view = toUserView(baseUser, 'customer');
    expect(view).toHaveProperty('id', 'uuid-1');
    expect(view).toHaveProperty('username', 'alice');
    expect(view).toHaveProperty('role', 'customer');
    expect(view).toHaveProperty('phone');
    expect(view).toHaveProperty('createdAt');
  });

  it('never includes passwordHash in output', () => {
    const view = toUserView(baseUser, 'customer') as Record<string, unknown>;
    expect(view).not.toHaveProperty('passwordHash');
  });

  it('never includes failedAttempts in output', () => {
    const view = toUserView(baseUser, 'customer') as Record<string, unknown>;
    expect(view).not.toHaveProperty('failedAttempts');
  });

  it('never includes lockedUntil in output', () => {
    const view = toUserView(baseUser, 'customer') as Record<string, unknown>;
    expect(view).not.toHaveProperty('lockedUntil');
  });

  it('serialises createdAt as ISO-8601 string', () => {
    const view = toUserView(baseUser, 'customer');
    expect(view.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(typeof view.createdAt).toBe('string');
  });

  it('exposes full phone for customer viewer', () => {
    const view = toUserView(baseUser, 'customer');
    expect(view.phone).toBe('+15558675309');
  });

  it.each<Role>(['associate', 'supervisor', 'manager', 'admin'])(
    'masks phone for staff viewer (%s)',
    (viewerRole) => {
      const view = toUserView(baseUser, viewerRole);
      expect(view.phone).toBe('********5309');
    },
  );

  it('returns null phone when user has no phone on record', () => {
    const noPhone = { ...baseUser, phone: null };
    expect(toUserView(noPhone, 'customer').phone).toBeNull();
    expect(toUserView(noPhone, 'admin').phone).toBeNull();
  });
});
