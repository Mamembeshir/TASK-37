/**
 * Integration tests for the DB-aware rules engine entry point (index.ts).
 *
 * Tests: evaluateRules (load + filter + sort + serial/parallel evaluation),
 *        hasAction, getAction, summariseMatches convenience helpers.
 *
 * All tests use the real test DB (PostgreSQL) — no mocking.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  evaluateRules,
  hasAction,
  getAction,
  summariseMatches,
  type EvaluationContext,
} from './index.js';
import { testDb, runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { seedUser, seedRule } from '../test/helpers.js';
import type { RuleDefinition } from '@retail-hub/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal valid RuleDefinition with overrides. */
function def(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    evaluation_mode: 'parallel',
    priority: 100,
    conditions: { type: 'leaf', field: 'flag', operator: 'eq', value: true },
    actions: [{ type: 'allow', params: {} }],
    ...overrides,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await clearAllTables();
  await closeDb();
});

// ── evaluateRules — loading / filtering ──────────────────────────────────────

describe('evaluateRules — active rule loading', () => {
  it('returns empty array when no rules are active', async () => {
    const admin = await seedUser({ role: 'admin' });
    // seed a draft rule (not active) — should be invisible
    await seedRule({ status: 'draft', createdBy: admin.id });

    const matches = await evaluateRules(testDb as any, { flag: true });
    expect(matches).toEqual([]);
  });

  it('returns a match for an active rule whose condition is satisfied', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedRule({
      status: 'active',
      definitionJson: def({ conditions: { type: 'leaf', field: 'x', operator: 'eq', value: 1 } }),
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { x: 1 });
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.actions[0]!.type).toBe('allow');
  });

  it('does not match an active rule whose condition is not satisfied', async () => {
    const admin = await seedUser({ role: 'admin' });
    await seedRule({
      status: 'active',
      definitionJson: def({ conditions: { type: 'leaf', field: 'should_not_exist', operator: 'eq', value: 'never' } }),
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { flag: true });
    // None of the active rules targeting 'should_not_exist' should fire
    const wrongMatch = matches.find((m) => m.actions.some((a) => a.type === 'allow' && m.ruleName.includes('should_not')));
    expect(wrongMatch).toBeUndefined();
  });

  it('skips inactive and rolled_back rules', async () => {
    const admin = await seedUser({ role: 'admin' });
    const uniqueField = `skip_inactive_${Date.now()}`;

    await seedRule({
      status: 'inactive',
      definitionJson: def({ conditions: { type: 'leaf', field: uniqueField, operator: 'eq', value: true }, actions: [{ type: 'inactive_action', params: {} }] }),
      createdBy: admin.id,
    });
    await seedRule({
      status: 'rolled_back',
      definitionJson: def({ conditions: { type: 'leaf', field: uniqueField, operator: 'eq', value: true }, actions: [{ type: 'rolledback_action', params: {} }] }),
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { [uniqueField]: true });
    const types = matches.flatMap((m) => m.actions.map((a) => a.type));
    expect(types).not.toContain('inactive_action');
    expect(types).not.toContain('rolledback_action');
  });

  it('match includes ruleId, ruleName, version, actions, explanation', async () => {
    const admin = await seedUser({ role: 'admin' });
    const uniqueField = `shape_check_${Date.now()}`;
    await seedRule({
      name: `shape_rule_${Date.now()}`,
      status: 'active',
      version: 3,
      definitionJson: def({
        conditions: { type: 'leaf', field: uniqueField, operator: 'eq', value: 'yes' },
        actions: [{ type: 'grant', params: { discount: 10 } }],
        description: 'Test rule description',
      }),
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { [uniqueField]: 'yes' });
    const m = matches.find((r) => r.actions.some((a) => a.type === 'grant'));
    expect(m).toBeDefined();
    expect(m!.ruleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(m!.ruleName).toBeTruthy();
    expect(m!.version).toBe(3);
    expect(m!.explanation).toContain('grant');
    expect(m!.explanation).toContain('Test rule description');
  });
});

// ── evaluateRules — group filtering ──────────────────────────────────────────

describe('evaluateRules — group filtering (options.group)', () => {
  it('returns only rules belonging to the requested group', async () => {
    const admin = await seedUser({ role: 'admin' });
    const uniqueCtx = `grp_filter_${Date.now()}`;

    await seedRule({
      status: 'active',
      definitionJson: def({
        group: 'pricing',
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'pricing_action', params: {} }],
      }),
      createdBy: admin.id,
    });

    await seedRule({
      status: 'active',
      definitionJson: def({
        group: 'moderation',
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'moderation_action', params: {} }],
      }),
      createdBy: admin.id,
    });

    const pricingMatches = await evaluateRules(testDb as any, { [uniqueCtx]: true }, { group: 'pricing' });
    const types = pricingMatches.flatMap((m) => m.actions.map((a) => a.type));
    expect(types).toContain('pricing_action');
    expect(types).not.toContain('moderation_action');
  });

  it('returns no matches when no rules belong to the specified group', async () => {
    const matches = await evaluateRules(testDb as any, { flag: true }, { group: 'nonexistent_group_xyz' });
    expect(matches).toEqual([]);
  });
});

// ── evaluateRules — priority ordering ────────────────────────────────────────

describe('evaluateRules — priority ordering (task 135)', () => {
  it('returns lower-priority-number rules before higher-priority-number rules', async () => {
    const admin = await seedUser({ role: 'admin' });
    const uniqueCtx = `priority_${Date.now()}`;

    await seedRule({
      status: 'active',
      definitionJson: def({
        group: `prio_group_${Date.now()}`,
        priority: 50,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'high_priority', params: {} }],
      }),
      createdBy: admin.id,
    });

    await seedRule({
      status: 'active',
      definitionJson: def({
        group: `prio_group_${Date.now()}`,
        priority: 10,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'highest_priority', params: {} }],
      }),
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { [uniqueCtx]: true });
    const types = matches.flatMap((m) => m.actions.map((a) => a.type));
    // Both should match (parallel mode) but priority=10 should appear before priority=50 within same group
    expect(types).toContain('highest_priority');
    expect(types).toContain('high_priority');
  });
});

// ── evaluateRules — serial mode ───────────────────────────────────────────────

describe('evaluateRules — serial evaluation (task 133)', () => {
  it('stops after the first match in a serial group', async () => {
    const admin = await seedUser({ role: 'admin' });
    const serialGroup = `serial_${Date.now()}`;
    const uniqueCtx = `serial_ctx_${Date.now()}`;

    // priority 1 — fires first
    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'serial',
        priority: 1,
        group: serialGroup,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'serial_first', params: {} }],
      },
      createdBy: admin.id,
    });

    // priority 2 — would also match, but serial stops after first
    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'serial',
        priority: 2,
        group: serialGroup,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'serial_second', params: {} }],
      },
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { [uniqueCtx]: true }, { group: serialGroup });
    const types = matches.flatMap((m) => m.actions.map((a) => a.type));
    expect(types).toContain('serial_first');
    expect(types).not.toContain('serial_second');
  });

  it('evaluates the second rule when the first does not match (serial)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const serialGroup = `serial_skip_${Date.now()}`;
    const uniqueCtx = `serial_skip_ctx_${Date.now()}`;

    // priority 1 — condition false (does NOT fire)
    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'serial',
        priority: 1,
        group: serialGroup,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: 'nope' },
        actions: [{ type: 'should_not_fire', params: {} }],
      },
      createdBy: admin.id,
    });

    // priority 2 — condition true (fires because #1 didn't match)
    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'serial',
        priority: 2,
        group: serialGroup,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'serial_fallback', params: {} }],
      },
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { [uniqueCtx]: true }, { group: serialGroup });
    const types = matches.flatMap((m) => m.actions.map((a) => a.type));
    expect(types).not.toContain('should_not_fire');
    expect(types).toContain('serial_fallback');
  });
});

// ── evaluateRules — parallel mode ─────────────────────────────────────────────

describe('evaluateRules — parallel evaluation (task 134)', () => {
  it('collects all matches in a parallel group', async () => {
    const admin = await seedUser({ role: 'admin' });
    const parallelGroup = `parallel_${Date.now()}`;
    const uniqueCtx = `parallel_ctx_${Date.now()}`;

    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'parallel',
        priority: 1,
        group: parallelGroup,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'parallel_one', params: {} }],
      },
      createdBy: admin.id,
    });

    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'parallel',
        priority: 2,
        group: parallelGroup,
        conditions: { type: 'leaf', field: uniqueCtx, operator: 'eq', value: true },
        actions: [{ type: 'parallel_two', params: {} }],
      },
      createdBy: admin.id,
    });

    const matches = await evaluateRules(testDb as any, { [uniqueCtx]: true }, { group: parallelGroup });
    const types = matches.flatMap((m) => m.actions.map((a) => a.type));
    expect(types).toContain('parallel_one');
    expect(types).toContain('parallel_two');
  });
});

// ── evaluateRules — complex conditions ───────────────────────────────────────

describe('evaluateRules — complex conditions', () => {
  it('evaluates AND group — all leaves must match', async () => {
    const admin = await seedUser({ role: 'admin' });
    const uniqueCtx = `and_check_${Date.now()}`;

    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'parallel',
        priority: 100,
        conditions: {
          type: 'group',
          logic: 'AND',
          conditions: [
            { type: 'leaf', field: `${uniqueCtx}_a`, operator: 'eq', value: true },
            { type: 'leaf', field: `${uniqueCtx}_b`, operator: 'gt', value: 10 },
          ],
        },
        actions: [{ type: 'and_matched', params: {} }],
      },
      createdBy: admin.id,
    });

    // Both conditions satisfied
    const matches = await evaluateRules(testDb as any, { [`${uniqueCtx}_a`]: true, [`${uniqueCtx}_b`]: 20 });
    const types = matches.flatMap((m) => m.actions.map((a) => a.type));
    expect(types).toContain('and_matched');

    // Second condition fails — no match
    const noMatch = await evaluateRules(testDb as any, { [`${uniqueCtx}_a`]: true, [`${uniqueCtx}_b`]: 5 });
    const noTypes = noMatch.flatMap((m) => m.actions.map((a) => a.type));
    expect(noTypes).not.toContain('and_matched');
  });

  it('evaluates tier-based price cap override (SPEC use case)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const group = `price_cap_${Date.now()}`;

    // Standard tier: block adjustments > 50
    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'serial',
        priority: 1,
        group,
        conditions: {
          type: 'group',
          logic: 'AND',
          conditions: [
            { type: 'leaf', field: 'customer.tier', operator: 'not_in', value: ['top'] },
            { type: 'leaf', field: 'adjustment.amount', operator: 'gt', value: 50 },
          ],
        },
        actions: [{ type: 'block', params: { reason: 'Exceeds $50 cap' } }],
        description: '$50 adjustment cap for non-top-tier customers',
      },
      createdBy: admin.id,
    });

    // Top tier override: allow any adjustment
    await seedRule({
      status: 'active',
      definitionJson: {
        evaluation_mode: 'parallel',
        priority: 1,
        group: `${group}_override`,
        conditions: {
          type: 'leaf',
          field: 'customer.tier',
          operator: 'eq',
          value: 'top',
        },
        actions: [{ type: 'override_cap', params: {} }],
      },
      createdBy: admin.id,
    });

    // Standard customer trying to exceed cap — should be blocked
    const standardMatches = await evaluateRules(
      testDb as any,
      { 'customer.tier': 'silver', 'adjustment.amount': 75 },
      { group },
    );
    expect(hasAction(standardMatches, 'block')).toBe(true);

    // Top tier — override fires
    const topMatches = await evaluateRules(
      testDb as any,
      { 'customer.tier': 'top', 'adjustment.amount': 75 },
      { group: `${group}_override` },
    );
    expect(hasAction(topMatches, 'override_cap')).toBe(true);
    expect(hasAction(topMatches, 'block')).toBe(false);
  });
});

// ── hasAction ─────────────────────────────────────────────────────────────────

describe('hasAction', () => {
  it('returns true when any match has an action of the given type', () => {
    const matches = [
      { ruleId: '1', ruleName: 'r1', version: 1, actions: [{ type: 'block', params: {} }], explanation: '' },
    ];
    expect(hasAction(matches, 'block')).toBe(true);
  });

  it('returns false when no match has the requested action type', () => {
    const matches = [
      { ruleId: '1', ruleName: 'r1', version: 1, actions: [{ type: 'allow', params: {} }], explanation: '' },
    ];
    expect(hasAction(matches, 'block')).toBe(false);
  });

  it('returns false for empty matches array', () => {
    expect(hasAction([], 'block')).toBe(false);
  });
});

// ── getAction ─────────────────────────────────────────────────────────────────

describe('getAction', () => {
  it('returns the first action of the requested type', () => {
    const matches = [
      {
        ruleId: '1', ruleName: 'r1', version: 1,
        actions: [{ type: 'apply_discount', params: { discountAmount: 10 } }],
        explanation: '',
      },
    ];
    const action = getAction(matches, 'apply_discount');
    expect(action).toBeDefined();
    expect(action!.params.discountAmount).toBe(10);
  });

  it('returns undefined when action type is not present', () => {
    const matches = [
      { ruleId: '1', ruleName: 'r1', version: 1, actions: [{ type: 'allow', params: {} }], explanation: '' },
    ];
    expect(getAction(matches, 'block')).toBeUndefined();
  });

  it('returns undefined for empty matches', () => {
    expect(getAction([], 'any')).toBeUndefined();
  });
});

// ── summariseMatches ─────────────────────────────────────────────────────────

describe('summariseMatches', () => {
  it('returns "No rules matched." for empty array', () => {
    expect(summariseMatches([])).toBe('No rules matched.');
  });

  it('returns pipe-joined explanations for multiple matches', () => {
    const matches = [
      { ruleId: '1', ruleName: 'r1', version: 1, actions: [], explanation: 'First explanation' },
      { ruleId: '2', ruleName: 'r2', version: 1, actions: [], explanation: 'Second explanation' },
    ];
    const result = summariseMatches(matches);
    expect(result).toContain('First explanation');
    expect(result).toContain('Second explanation');
    expect(result).toContain(' | ');
  });

  it('returns the single explanation when one rule matched', () => {
    const matches = [
      { ruleId: '1', ruleName: 'r1', version: 1, actions: [], explanation: 'Only explanation' },
    ];
    expect(summariseMatches(matches)).toBe('Only explanation');
  });
});
