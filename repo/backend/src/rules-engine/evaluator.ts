/**
 * Pure rules evaluation logic — no DB access, fully synchronous.
 *
 * Implements:
 *   Task 130 — field comparisons and recursive AND/OR logic
 *   Task 131 — allowlist (in) / denylist (not_in) operators
 *   Task 132 — threshold operators (gt / gte / lt / lte)
 *   Task 136 — human-readable hit explanation per matched rule
 */

import type {
  Condition,
  ConditionLeaf,
  ConditionGroup,
  RuleDefinition,
  RuleAction,
} from '@retail-hub/shared';

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * Flat-or-nested record passed to the evaluator.
 * Fields addressed with dot-notation strings (e.g. "customer.tier",
 * "adjustment.amount").  Both flat keys ("adjustment.amount") and nested
 * objects ({ adjustment: { amount: 45 } }) are resolved correctly.
 */
export type EvaluationContext = Record<string, unknown>;

// ── Result ────────────────────────────────────────────────────────────────────

/** One matched rule with its triggered actions and a human-readable explanation. */
export interface RuleMatch {
  ruleId: string;
  ruleName: string;
  version: number;
  actions: RuleAction[];
  /** Human-readable description of why this rule fired (task 136). */
  explanation: string;
}

// ── Field lookup ──────────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation field path against the context.
 * Tries flat key first ("customer.tier"), then nested traversal.
 */
function getField(context: EvaluationContext, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(context, field)) return context[field];
  return field.split('.').reduce<unknown>((obj, key) => {
    if (obj !== null && obj !== undefined && typeof obj === 'object') {
      return (obj as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
}

// ── Leaf evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate a single leaf condition against the context.
 * Covers all 11 operators defined in ruleOperatorSchema (task 130–132).
 */
function evaluateLeaf(leaf: ConditionLeaf, context: EvaluationContext): boolean {
  const actual = getField(context, leaf.field);
  const { operator, value } = leaf;

  switch (operator) {
    // Equality
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;

    // Numeric threshold comparisons (task 132)
    case 'gt':
      return typeof actual === 'number' && typeof value === 'number' && actual > value;
    case 'gte':
      return typeof actual === 'number' && typeof value === 'number' && actual >= value;
    case 'lt':
      return typeof actual === 'number' && typeof value === 'number' && actual < value;
    case 'lte':
      return typeof actual === 'number' && typeof value === 'number' && actual <= value;

    // Allowlist / denylist (task 131)
    case 'in':
      return Array.isArray(value) && value.includes(actual as string | number);
    case 'not_in':
      return Array.isArray(value) && !value.includes(actual as string | number);

    // String / array containment
    case 'contains':
      if (typeof actual === 'string' && typeof value === 'string') {
        return actual.toLowerCase().includes(value.toLowerCase());
      }
      if (Array.isArray(actual)) return actual.includes(value);
      return false;
    case 'not_contains':
      if (typeof actual === 'string' && typeof value === 'string') {
        return !actual.toLowerCase().includes(value.toLowerCase());
      }
      if (Array.isArray(actual)) return !actual.includes(value);
      return false;

    // Offline regex matching (mirrors moderation scanner pattern)
    case 'matches_regex':
      if (typeof actual !== 'string' || typeof value !== 'string') return false;
      try {
        return new RegExp(value, 'i').test(actual);
      } catch {
        // Invalid regex — skip defensively (same approach as moderation.ts task 93)
        return false;
      }

    default:
      return false;
  }
}

// ── Condition tree evaluation ─────────────────────────────────────────────────

/**
 * Recursively evaluate a condition tree (task 130).
 *   leaf  → evaluateLeaf()
 *   group → AND: all children must match; OR: any child must match
 */
export function evaluateCondition(
  condition: Condition,
  context: EvaluationContext,
): boolean {
  if (condition.type === 'leaf') {
    return evaluateLeaf(condition, context);
  }

  // group — cast is safe because conditionSchema is a discriminated union
  const group = condition as ConditionGroup;
  if (group.logic === 'AND') {
    return group.conditions.every((c: Condition) => evaluateCondition(c, context));
  }
  // OR
  return group.conditions.some((c: Condition) => evaluateCondition(c, context));
}

// ── Hit explanation ───────────────────────────────────────────────────────────

/**
 * Generate a human-readable string explaining why a rule fired and what
 * actions it triggers (task 136).
 *
 * Format:  Rule "<name>" [— <description>] matched: <action summaries>
 * Example: Rule "price_adjustment_cap" — $50 cap per order matched:
 *            block({"reason":"Adjustment exceeds $50 cap"})
 */
export function generateExplanation(
  ruleName: string,
  definition: RuleDefinition,
): string {
  const actionSummary = definition.actions
    .map((a: RuleAction) => {
      if (a.description) return a.description;
      const paramsStr =
        Object.keys(a.params).length > 0 ? `(${JSON.stringify(a.params)})` : '';
      return `${a.type}${paramsStr}`;
    })
    .join('; ');

  const descPart = definition.description ? ` — ${definition.description}` : '';
  return `Rule "${ruleName}"${descPart} matched: ${actionSummary}`;
}
