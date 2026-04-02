/**
 * Integration tests for admin rules CRUD + publish + rollback:
 *   GET  /admin/rules
 *   GET  /admin/rules/:id
 *   POST /admin/rules
 *   PUT  /admin/rules/:id
 *   POST /admin/rules/:id/publish
 *   POST /admin/rules/:id/rollback
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, runMigrations, clearAllTables, closeDb } from '../../test/db.js';
import { buildAdminRulesTestApp } from '../../test/app.js';
import { inject } from '../../test/client.js';
import { seedUser, seedRule, seedRuleHistory, MINIMAL_RULE_DEF } from '../../test/helpers.js';
import { rules, rulesHistory } from '../../db/schema/rules.js';
import { auditLogs } from '../../db/schema/audit-logs.js';
import type { FastifyInstance } from 'fastify';
import type { RuleDefinition } from '@retail-hub/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(username: string, password = 'password1234'): Promise<string> {
  const res = await inject(url, {
    method: 'POST',
    url: '/auth/login',
    payload: { username, password },
  });
  return `Bearer ${res.json().token}`;
}

const VALID_DEF: RuleDefinition = {
  evaluation_mode: 'parallel',
  priority: 10,
  group: 'test-group',
  conditions: { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'gold' },
  actions: [{ type: 'apply_discount', params: { amount: 10 }, description: '10% discount for gold' }],
  description: 'Gold tier discount',
};

const INVALID_DEF = {
  // Missing required `conditions` and `actions` fields
  evaluation_mode: 'parallel',
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  await runMigrations();
  ({ app, url } = await buildAdminRulesTestApp());
});

afterAll(async () => {
  await app.close();
  await clearAllTables();
  await closeDb();
});

// ── GET /admin/rules ──────────────────────────────────────────────────────────

describe('GET /admin/rules', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/admin/rules' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin roles', async () => {
    for (const role of ['customer', 'associate', 'supervisor', 'manager'] as const) {
      const user = await seedUser({ role });
      const auth = await loginAs(user.username);
      const res = await inject(url, {
        method: 'GET',
        url: '/admin/rules',
        headers: { authorization: auth },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('returns paginated rules list for admin (200)', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedRule({ createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/rules',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(typeof json.total).toBe('number');
    expect(Array.isArray(json.data)).toBe(true);
    expect(typeof json.limit).toBe('number');
    expect(typeof json.offset).toBe('number');
  });

  it('respects limit and offset pagination', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedRule({ createdBy: admin.id });
    await seedRule({ createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/rules?limit=1&offset=0',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('list items do not include definitionJson (summary only)', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedRule({ createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/rules',
      headers: { authorization: auth },
    });
    const item = res.json().data[0];
    expect(item).toHaveProperty('name');
    expect(item).toHaveProperty('version');
    expect(item).toHaveProperty('status');
    expect(item).not.toHaveProperty('definitionJson');
  });
});

// ── GET /admin/rules/:id ──────────────────────────────────────────────────────

describe('GET /admin/rules/:id', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'GET', url: '/admin/rules/00000000-0000-0000-0000-000000000001' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const associate = await seedUser({ role: 'associate' });
    const auth = await loginAs(associate.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/rules/00000000-0000-0000-0000-000000000001',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when rule does not exist', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/rules/00000000-0000-0000-0000-000000000002',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns rule detail with definitionJson (200)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ definitionJson: VALID_DEF, createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: `/admin/rules/${rule.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.id).toBe(rule.id);
    expect(json.definitionJson).toBeDefined();
    expect(json.definitionJson.evaluation_mode).toBe('parallel');
  });

  it('returns 400 for non-UUID param', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'GET',
      url: '/admin/rules/not-a-uuid',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /admin/rules ─────────────────────────────────────────────────────────

describe('POST /admin/rules', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules',
      payload: { name: 'x', adminComment: 'y', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const user = await seedUser({ role: 'supervisor' });
    const auth = await loginAs(user.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules',
      headers: { authorization: auth },
      payload: { name: 'x', adminComment: 'y', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when adminComment is missing', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules',
      headers: { authorization: auth },
      payload: { name: 'my-rule', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when definitionJson is invalid', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules',
      headers: { authorization: auth },
      payload: { name: 'bad-def', adminComment: 'testing', definitionJson: INVALID_DEF },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates rule as draft (201) with version=1', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);
    const ruleName = `new_rule_${Date.now()}`;

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules',
      headers: { authorization: auth },
      payload: { name: ruleName, adminComment: 'First draft', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.name).toBe(ruleName);
    expect(json.status).toBe('draft');
    expect(json.version).toBe(1);
    expect(json.createdBy).toBe(admin.id);
    expect(json.definitionJson).toBeDefined();
    expect(json.publishedAt).toBeNull();
  });

  it('returns 409 when a rule with the same name already exists', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);
    const existingName = `dup_rule_${Date.now()}`;

    await seedRule({ name: existingName, createdBy: admin.id });

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules',
      headers: { authorization: auth },
      payload: { name: existingName, adminComment: 'Duplicate', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already exists/i);
  });
});

// ── PUT /admin/rules/:id ──────────────────────────────────────────────────────

describe('PUT /admin/rules/:id', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, {
      method: 'PUT',
      url: '/admin/rules/00000000-0000-0000-0000-000000000001',
      payload: { adminComment: 'update' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when rule does not exist', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PUT',
      url: '/admin/rules/00000000-0000-0000-0000-000000000003',
      headers: { authorization: auth },
      payload: { adminComment: 'update' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('increments version on update (200)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ version: 1, createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/admin/rules/${rule.id}`,
      headers: { authorization: auth },
      payload: { adminComment: 'Updated definition', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(2);
  });

  it('snapshots previous version into rules_history', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ version: 1, createdBy: admin.id });
    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'PUT',
      url: `/admin/rules/${rule.id}`,
      headers: { authorization: auth },
      payload: { adminComment: 'v2 update', definitionJson: VALID_DEF },
    });

    const histRows = await testDb
      .select()
      .from(rulesHistory)
      .where(eq(rulesHistory.ruleId, rule.id));
    expect(histRows).toHaveLength(1);
    expect(histRows[0]!.version).toBe(1); // snapshotted version 1
  });

  it('demotes active rule back to draft on update', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ status: 'active', createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/admin/rules/${rule.id}`,
      headers: { authorization: auth },
      payload: { adminComment: 'Changed after publish', definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('draft');
  });

  it('returns 409 when renaming to an already-taken name', async () => {
    const admin = await seedUser({ role: 'admin' });
    const existing = await seedRule({ name: `taken_${Date.now()}`, createdBy: admin.id });
    const rule = await seedRule({ createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/admin/rules/${rule.id}`,
      headers: { authorization: auth },
      payload: { name: existing.name, adminComment: 'rename conflict' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when adminComment is missing', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'PUT',
      url: `/admin/rules/${rule.id}`,
      headers: { authorization: auth },
      payload: { definitionJson: VALID_DEF },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /admin/rules/:id/publish ─────────────────────────────────────────────

describe('POST /admin/rules/:id/publish', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, { method: 'POST', url: '/admin/rules/00000000-0000-0000-0000-000000000001/publish' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when rule does not exist', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules/00000000-0000-0000-0000-000000000004/publish',
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when rule is already active', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ status: 'active', createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/publish`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already active/i);
  });

  it('sets status=active and publishedAt (200)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ status: 'draft', createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/publish`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('active');
    expect(json.publishedAt).not.toBeNull();
    expect(json.definitionJson).toBeDefined();
  });

  it('can publish a rolled_back rule (re-activating it)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ status: 'rolled_back', createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/publish`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('active');
  });
});

// ── POST /admin/rules/:id/rollback ────────────────────────────────────────────

describe('POST /admin/rules/:id/rollback', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules/00000000-0000-0000-0000-000000000001/rollback',
      payload: { adminComment: 'rollback' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const supervisor = await seedUser({ role: 'supervisor' });
    const auth = await loginAs(supervisor.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules/00000000-0000-0000-0000-000000000001/rollback',
      headers: { authorization: auth },
      payload: { adminComment: 'rollback' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when rule does not exist', async () => {
    const admin = await seedUser({ role: 'admin' });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: '/admin/rules/00000000-0000-0000-0000-000000000005/rollback',
      headers: { authorization: auth },
      payload: { adminComment: 'rollback' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when no history exists to roll back to', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ status: 'active', createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/rollback`,
      headers: { authorization: auth },
      payload: { adminComment: 'no history' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/no previous version/i);
  });

  it('restores previous version and increments version counter (200)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const previousDef: RuleDefinition = {
      ...MINIMAL_RULE_DEF,
      actions: [{ type: 'restore_action', params: { restored: true } }],
    };

    const rule = await seedRule({ version: 2, status: 'active', createdBy: admin.id });
    // Plant a history row (simulating a previous published version)
    await seedRuleHistory({ ruleId: rule.id, version: 1, status: 'active', definitionJson: previousDef, createdBy: admin.id });

    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/rollback`,
      headers: { authorization: auth },
      payload: { adminComment: 'Rolling back to v1' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('active');
    expect(json.version).toBe(3); // 2 + 1 (monotonically incremented)
    expect(json.adminComment).toBe('Rolling back to v1');
    // The definition should now reflect the restored version
    expect((json.definitionJson as any).actions[0].type).toBe('restore_action');
  });

  it('archives current version to rules_history during rollback', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ version: 2, status: 'active', createdBy: admin.id });
    await seedRuleHistory({ ruleId: rule.id, version: 1, status: 'active', createdBy: admin.id });

    const auth = await loginAs(admin.username);

    const histBefore = await testDb
      .select()
      .from(rulesHistory)
      .where(eq(rulesHistory.ruleId, rule.id));

    await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/rollback`,
      headers: { authorization: auth },
      payload: { adminComment: 'Archive check' },
    });

    const histAfter = await testDb
      .select()
      .from(rulesHistory)
      .where(eq(rulesHistory.ruleId, rule.id));

    // One new history row should have been added (archiving v2 as rolled_back)
    expect(histAfter.length).toBe(histBefore.length + 1);
    const archivedRow = histAfter.find((h) => h.version === 2);
    expect(archivedRow).toBeDefined();
    expect(archivedRow!.status).toBe('rolled_back');
  });

  it('writes an immutable audit log on rollback', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ version: 2, status: 'active', createdBy: admin.id });
    await seedRuleHistory({ ruleId: rule.id, version: 1, status: 'active', createdBy: admin.id });

    const auth = await loginAs(admin.username);

    await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/rollback`,
      headers: { authorization: auth },
      payload: { adminComment: 'Audit log test' },
    });

    const logs = await testDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'rule.rolled_back'));

    const ruleLog = logs.find((l) => l.entityId === rule.id);
    expect(ruleLog).toBeDefined();
    expect(ruleLog!.actorId).toBe(admin.id);
    expect(ruleLog!.entityType).toBe('rule');
  });

  it('returns 400 when adminComment is missing for rollback', async () => {
    const admin = await seedUser({ role: 'admin' });
    const rule = await seedRule({ createdBy: admin.id });
    const auth = await loginAs(admin.username);

    const res = await inject(url, {
      method: 'POST',
      url: `/admin/rules/${rule.id}/rollback`,
      headers: { authorization: auth },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
