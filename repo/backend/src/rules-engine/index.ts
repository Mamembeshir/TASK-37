/**
 * DB-aware entry point for the rules engine.
 *
 * Implements:
 *   Task 129 — load active rules from DB
 *   Task 133 — serial evaluation: stop at first match per group
 *   Task 134 — parallel evaluation: collect all matches per group
 *   Task 135 — priority ordering within groups (lower number = higher precedence)
 *
 * Pure evaluation logic lives in ./evaluator.ts (no DB dependencies there).
 *
 * ── Integration hooks (task 137) ──────────────────────────────────────────────
 *
 * Callers build an EvaluationContext with dot-notation keys and pass it to
 * evaluateRules().  Standard context shapes used across the system:
 *
 *   Price-adjustment cap check:
 *     { 'adjustment.amount': number, 'customer.tier': string }
 *     → look for action type 'block' → reject if found
 *
 *   Coupon validation (task 138+):
 *     { 'coupon.code': string, 'order.total': number, 'customer.tier': string }
 *     → look for action type 'apply_discount' → extract params.discountAmount
 *
 *   Points calculation (task 140):
 *     { 'order.total': number, 'customer.tier': string }
 *     → look for action type 'add_points' → extract params.multiplier
 *
 *   Tier benefit check (task 139):
 *     { 'customer.tier': string }
 *     → look for action type 'override_cap' → bypass $50 limit
 *
 *   Moderation decision (task 137):
 *     { 'content.text': string, 'content.type': string }
 *     → look for action type 'flag' → escalate to moderation queue
 */

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { rules } from '../db/schema/rules';
import { ruleDefinitionSchema } from '@retail-hub/shared';
import {
  evaluateCondition,
  generateExplanation,
  type EvaluationContext,
  type RuleMatch,
} from './evaluator';

type Db = FastifyInstance['db'];

export type { EvaluationContext, RuleMatch };

// ── Options ───────────────────────────────────────────────────────────────────

export interface EvaluateOptions {
  /**
   * If provided, only rules whose definition.group matches this value are
   * evaluated (task 135 — group-scoped evaluation).
   */
  group?: string;
}

// ── Main evaluator ────────────────────────────────────────────────────────────

/**
 * Load all active rules from the DB, sort by group + priority, evaluate each
 * against `context`, and return every rule that matched.
 *
 * evaluation_mode is set per rule (not globally) so groups can mix modes:
 *   serial   — within a group, stop after the first match (task 133)
 *   parallel — within a group, collect every match (task 134)
 *
 * Rules with invalid definition JSON are silently skipped so a bad admin
 * entry never takes the whole system down (defensive, mirrors moderation.ts).
 */
export async function evaluateRules(
  db: Db,
  context: EvaluationContext,
  options?: EvaluateOptions,
): Promise<RuleMatch[]> {
  // ── 1. Load active rules from DB (task 129) ──────────────────────────────
  const activeRows = await db
    .select()
    .from(rules)
    .where(eq(rules.status, 'active'));

  // ── 2. Parse & filter ───────────────────────────────────────────────────
  const parsed = activeRows.flatMap((row) => {
    const result = ruleDefinitionSchema.safeParse(row.definitionJson);
    if (!result.success) return []; // skip invalid definitions

    const def = result.data;

    // Apply group filter when caller requests scoped evaluation
    if (options?.group !== undefined && def.group !== options.group) return [];

    return [{ row, def }];
  });

  // ── 3. Sort by group (nulls last) then priority asc (task 135) ───────────
  parsed.sort((a, b) => {
    // U+FFFF sorts after all normal strings → pushes ungrouped rules to end
    const ga = a.def.group ?? '\uffff';
    const gb = b.def.group ?? '\uffff';
    if (ga !== gb) return ga < gb ? -1 : 1;
    return (a.def.priority ?? 100) - (b.def.priority ?? 100);
  });

  // ── 4. Evaluate — serial short-circuits per group, parallel collects all ──
  //      (tasks 133, 134)
  const matches: RuleMatch[] = [];
  // Track groups where a serial match already fired
  const serialGroupsDone = new Set<string>();

  for (const { row, def } of parsed) {
    const groupKey = def.group ?? '__ungrouped__';

    // Serial mode: skip remaining rules in this group after first match
    if (def.evaluation_mode === 'serial' && serialGroupsDone.has(groupKey)) {
      continue;
    }

    if (evaluateCondition(def.conditions, context)) {
      matches.push({
        ruleId: row.id,
        ruleName: row.name,
        version: row.version,
        actions: def.actions,
        explanation: generateExplanation(row.name, def), // task 136
      });

      // Mark group done for serial mode after first match (task 133)
      if (def.evaluation_mode === 'serial') {
        serialGroupsDone.add(groupKey);
      }
    }
  }

  return matches;
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/**
 * True if any matched rule triggered an action of the given type.
 * Example: hasAction(matches, 'block') → reject the operation.
 */
export function hasAction(matches: RuleMatch[], actionType: string): boolean {
  return matches.some((m) => m.actions.some((a) => a.type === actionType));
}

/**
 * Return the first matched action of the given type, or undefined.
 * Example: getAction(matches, 'apply_discount')?.params.discountAmount
 */
export function getAction(
  matches: RuleMatch[],
  actionType: string,
): RuleMatch['actions'][number] | undefined {
  for (const m of matches) {
    const action = m.actions.find((a) => a.type === actionType);
    if (action) return action;
  }
  return undefined;
}

/**
 * Collect all explanations from matched rules as a human-readable string.
 * Useful for logging, API error messages, and audit trails (task 136).
 */
export function summariseMatches(matches: RuleMatch[]): string {
  if (matches.length === 0) return 'No rules matched.';
  return matches.map((m) => m.explanation).join(' | ');
}
