/**
 * Integration tests for admin user management:
 *   GET    /admin/users
 *   PATCH  /admin/users/:id/role
 *   POST   /admin/users/:id/reset-lockout
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, runMigrations, clearAllTables, closeDb } from '../../test/db.js';
import { buildAdminUsersTestApp } from '../../test/app.js';
import { inject } from '../../test/client.js';
import { seedUser } from '../../test/helpers.js';
import { auditLogs } from '../../db/schema/audit-logs.js';
import type { FastifyInstance } from 'fastify';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(username: string, password = 'password1234'): Promise<string> {
  const res = await inject(url, {
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  return `Bearer ${res.json<{ token: string }>().token}`;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  await runMigrations();
  ({ app, url } = await buildAdminUsersTestApp());
});

beforeEach(async () => {
  await clearAllTables();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ── GET /admin/users ──────────────────────────────────────────────────────────

describe('GET /admin/users', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin roles', async () => {
    for (const role of ['customer', 'associate', 'supervisor', 'manager'] as const) {
      const user = await seedUser({ role });
      const auth = await loginAs(user.username);
      const res = await inject(url, {
        method: 'GET',
        url: '/admin/users',
        headers: { authorization: auth },
      });
      expect(res.statusCode, `expected 403 for role ${role}`).toBe(403);
    }
  });

  it('returns paginated user list for admin (200)', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedUser({ role: 'customer' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json<{ data: unknown[]; total: number; limit: number; offset: number }>();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.total).toBeGreaterThanOrEqual(2);
    expect(typeof json.limit).toBe('number');
    expect(typeof json.offset).toBe('number');
  });

  it('each user item has the expected shape', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: auth },
    });
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    expect(data.length).toBeGreaterThan(0);
    const item = data[0]!;
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('username');
    expect(item).toHaveProperty('role');
    expect(item).toHaveProperty('phone');
    expect(item).toHaveProperty('isLocked');
    expect(item).toHaveProperty('failedAttempts');
    expect(item).toHaveProperty('lockedUntil');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('lastLoginAt');
  });

  it('lastLoginAt is non-null after the user has logged in', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username); // creates a session for admin

    const res = await inject(url, {
      method: 'GET',
      url: `/admin/users?q=${admin.username}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    const row = data.find((u) => u['username'] === admin.username);
    expect(row).toBeDefined();
    expect(row!['lastLoginAt']).not.toBeNull();
  });

  it('reflects isLocked: true for users with a future lockedUntil', async () => {
    const admin = await seedUser({ role: 'admin' });
    const lockedUser = await seedUser({
      role: 'customer',
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/admin/users?q=${lockedUser.username}`,
      headers: { authorization: auth },
    });
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    expect(data.length).toBe(1);
    expect(data[0]!['isLocked']).toBe(true);
    expect(data[0]!['failedAttempts']).toBe(5);
  });

  it('filters by role', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedUser({ role: 'customer' });
    await seedUser({ role: 'associate' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/users?role=customer',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    expect(data.every((u) => u['role'] === 'customer')).toBe(true);
  });

  it('filters by username (q param, case-insensitive)', async () => {
    const admin = await seedUser({ role: 'admin', username: `admin_${Date.now()}` });
    await seedUser({ username: `alice_${Date.now()}` });
    await seedUser({ username: `bob_${Date.now()}` });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/users?q=alice',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    expect(data.every((u) => (u['username'] as string).toLowerCase().includes('alice'))).toBe(true);
  });

  it('shows only locked users when isLocked=true', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedUser({
      role: 'customer',
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    await seedUser({ role: 'customer' }); // not locked
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/users?isLocked=true',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((u) => u['isLocked'] === true)).toBe(true);
  });

  it('respects limit pagination', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedUser({ role: 'customer' });
    await seedUser({ role: 'customer' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/users?limit=1&offset=0',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
  });
});

// ── PATCH /admin/users/:id/role ───────────────────────────────────────────────

describe('PATCH /admin/users/:id/role', () => {
  it('returns 401 when not authenticated', async () => {
    const target = await seedUser({ role: 'customer' });
    const res = await inject(url, {
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      payload: { role: 'associate' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin (manager)', async () => {
    const manager = await seedUser({ role: 'manager' });
    const target = await seedUser({ role: 'customer' });
    const auth = await loginAs(manager.username);

    const res = await inject(url, {
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: auth },
      payload: { role: 'associate' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for non-existent user', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PATCH',
      url: '/admin/users/00000000-0000-0000-0000-000000000000/role',
      headers: { authorization: auth },
      payload: { role: 'associate' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when the new role equals the current role', async () => {
    const admin = await seedUser({ role: 'admin' });
    const target = await seedUser({ role: 'customer' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: auth },
      payload: { role: 'customer' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('updates role and returns updated user', async () => {
    const admin = await seedUser({ role: 'admin' });
    const target = await seedUser({ role: 'customer' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: auth },
      payload: { role: 'associate' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; role: string }>();
    expect(body.id).toBe(target.id);
    expect(body.role).toBe('associate');
  });

  it('writes an audit log entry on role change', async () => {
    const admin = await seedUser({ role: 'admin' });
    const target = await seedUser({ role: 'customer' });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'PATCH',
      url: `/admin/users/${target.id}/role`,
      headers: { authorization: auth },
      payload: { role: 'associate' },
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, target.id));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.action === 'admin.user_role_changed')).toBe(true);
  });
});

// ── POST /admin/users/:id/reset-lockout ──────────────────────────────────────

describe('POST /admin/users/:id/reset-lockout', () => {
  it('returns 401 when not authenticated', async () => {
    const target = await seedUser({ role: 'customer' });
    const res = await inject(url, {
      method: 'POST',
      url: `/admin/users/${target.id}/reset-lockout`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin (manager)', async () => {
    const manager = await seedUser({ role: 'manager' });
    const target = await seedUser({ role: 'customer' });
    const auth = await loginAs(manager.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/users/${target.id}/reset-lockout`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for non-existent user', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/users/00000000-0000-0000-0000-000000000000/reset-lockout',
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('clears failedAttempts and lockedUntil, returns updated user', async () => {
    const admin = await seedUser({ role: 'admin' });
    const lockedUser = await seedUser({
      role: 'customer',
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/users/${lockedUser.id}/reset-lockout`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ isLocked: boolean; failedAttempts: number; lockedUntil: null }>();
    expect(body.isLocked).toBe(false);
    expect(body.failedAttempts).toBe(0);
    expect(body.lockedUntil).toBeNull();
  });

  it('writes an audit log entry on lockout reset', async () => {
    const admin = await seedUser({ role: 'admin' });
    const lockedUser = await seedUser({
      role: 'customer',
      failedAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/users/${lockedUser.id}/reset-lockout`,
      headers: { authorization: auth },
      payload: {},
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, lockedUser.id));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.action === 'admin.user_lockout_reset')).toBe(true);
  });

  it('also works on a non-locked user (idempotent)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const normalUser = await seedUser({ role: 'customer' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/users/${normalUser.id}/reset-lockout`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ isLocked: boolean; failedAttempts: number }>();
    expect(body.isLocked).toBe(false);
    expect(body.failedAttempts).toBe(0);
  });
});
