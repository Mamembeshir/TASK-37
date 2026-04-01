/**
 * Unit tests for the pure rules evaluator (no DB, no Fastify).
 * Covers: leaf operators, AND/OR groups, dot-notation field access,
 * generateExplanation output, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { evaluateCondition, generateExplanation } from './evaluator.js';
import type { EvaluationContext } from './evaluator.js';
import type { Condition, RuleDefinition } from '@retail-hub/shared';

// ── Leaf: equality ─────────────────────────────────────────────────────────

describe('evaluateCondition — eq / ne', () => {
  it('matches equal string value', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'gold' };
    expect(evaluateCondition(cond, { 'customer.tier': 'gold' })).toBe(true);
  });

  it('does not match different string value', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'gold' };
    expect(evaluateCondition(cond, { 'customer.tier': 'standard' })).toBe(false);
  });

  it('ne operator returns true when values differ', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'ne', value: 'top' };
    expect(evaluateCondition(cond, { 'customer.tier': 'silver' })).toBe(true);
  });
});

// ── Leaf: numeric thresholds ───────────────────────────────────────────────

describe('evaluateCondition — numeric operators', () => {
  const ctx: EvaluationContext = { 'adjustment.amount': 45 };

  it('gt: 45 > 50 is false', () => {
    const cond: Condition = { type: 'leaf', field: 'adjustment.amount', operator: 'gt', value: 50 };
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it('lte: 45 <= 50 is true', () => {
    const cond: Condition = { type: 'leaf', field: 'adjustment.amount', operator: 'lte', value: 50 };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it('gte: 50 >= 50 is true', () => {
    const cond: Condition = { type: 'leaf', field: 'adjustment.amount', operator: 'gte', value: 50 };
    expect(evaluateCondition({ type: 'leaf', field: 'adjustment.amount', operator: 'gte', value: 50 }, { 'adjustment.amount': 50 })).toBe(true);
  });

  it('gt on non-number returns false', () => {
    const cond: Condition = { type: 'leaf', field: 'adjustment.amount', operator: 'gt', value: 10 };
    expect(evaluateCondition(cond, { 'adjustment.amount': 'fifty' })).toBe(false);
  });
});

// ── Leaf: allowlist / denylist ─────────────────────────────────────────────

describe('evaluateCondition — in / not_in', () => {
  it('in: value present in list', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'in', value: ['gold', 'top'] };
    expect(evaluateCondition(cond, { 'customer.tier': 'top' })).toBe(true);
  });

  it('in: value absent from list', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'in', value: ['gold', 'top'] };
    expect(evaluateCondition(cond, { 'customer.tier': 'standard' })).toBe(false);
  });

  it('not_in: value not in list returns true', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'not_in', value: ['gold', 'top'] };
    expect(evaluateCondition(cond, { 'customer.tier': 'silver' })).toBe(true);
  });
});

// ── Leaf: contains / regex ─────────────────────────────────────────────────

describe('evaluateCondition — contains / matches_regex', () => {
  it('contains: case-insensitive substring match', () => {
    const cond: Condition = { type: 'leaf', field: 'content.text', operator: 'contains', value: 'spam' };
    expect(evaluateCondition(cond, { 'content.text': 'This is SPAM content' })).toBe(true);
  });

  it('matches_regex: matches pattern', () => {
    const cond: Condition = { type: 'leaf', field: 'content.text', operator: 'matches_regex', value: '\\b(buy now|click here)\\b' };
    expect(evaluateCondition(cond, { 'content.text': 'Buy Now for great deals' })).toBe(true);
  });

  it('matches_regex: invalid regex returns false without throwing', () => {
    const cond: Condition = { type: 'leaf', field: 'content.text', operator: 'matches_regex', value: '[invalid' };
    expect(() => evaluateCondition(cond, { 'content.text': 'any text' })).not.toThrow();
    expect(evaluateCondition(cond, { 'content.text': 'any text' })).toBe(false);
  });
});

// ── Nested field access (dot-notation) ────────────────────────────────────

describe('evaluateCondition — nested object context', () => {
  it('resolves nested field via dot traversal', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'top' };
    // Context provided as nested object, not flat key
    expect(evaluateCondition(cond, { customer: { tier: 'top' } })).toBe(true);
  });

  it('returns false for missing nested field', () => {
    const cond: Condition = { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'top' };
    expect(evaluateCondition(cond, { customer: {} })).toBe(false);
  });
});

// ── AND / OR groups ────────────────────────────────────────────────────────

describe('evaluateCondition — AND / OR groups', () => {
  const tierTop: Condition = { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'top' };
  const amountOver50: Condition = { type: 'leaf', field: 'adjustment.amount', operator: 'gt', value: 50 };

  it('AND: both true → true', () => {
    const group: Condition = { type: 'group', logic: 'AND', conditions: [tierTop, amountOver50] };
    expect(evaluateCondition(group, { 'customer.tier': 'top', 'adjustment.amount': 60 })).toBe(true);
  });

  it('AND: one false → false', () => {
    const group: Condition = { type: 'group', logic: 'AND', conditions: [tierTop, amountOver50] };
    expect(evaluateCondition(group, { 'customer.tier': 'silver', 'adjustment.amount': 60 })).toBe(false);
  });

  it('OR: one true → true', () => {
    const group: Condition = { type: 'group', logic: 'OR', conditions: [tierTop, amountOver50] };
    expect(evaluateCondition(group, { 'customer.tier': 'standard', 'adjustment.amount': 60 })).toBe(true);
  });

  it('OR: both false → false', () => {
    const group: Condition = { type: 'group', logic: 'OR', conditions: [tierTop, amountOver50] };
    expect(evaluateCondition(group, { 'customer.tier': 'standard', 'adjustment.amount': 30 })).toBe(false);
  });
});

// ── generateExplanation ────────────────────────────────────────────────────

describe('generateExplanation', () => {
  it('returns a non-empty string for a simple rule', () => {
    const rule: RuleDefinition = {
      group: 'price-cap',
      evaluation_mode: 'serial',
      priority: 1,
      conditions: { type: 'leaf', field: 'customer.tier', operator: 'eq', value: 'top' },
      actions: [{ type: 'override_cap', params: {} }],
    };
    const explanation = generateExplanation('top_tier_cap_override', rule);
    expect(typeof explanation).toBe('string');
    expect(explanation.length).toBeGreaterThan(0);
    expect(explanation).toContain('top_tier_cap_override');
  });
});
