import { z } from 'zod';

// ── Condition operators ────────────────────────────────────────────────────────

/**
 * Operators for a single condition leaf.
 *   eq / ne           — equality
 *   gt / gte / lt / lte — numeric comparisons (threshold support, task 132)
 *   in / not_in       — allowlist / denylist checks (task 131)
 *   contains / not_contains — substring / array membership
 *   matches_regex     — offline pattern matching (mirrors moderation scanner)
 */
export const ruleOperatorSchema = z.enum([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'matches_regex',
]);

export type RuleOperator = z.infer<typeof ruleOperatorSchema>;

// ── Condition leaf ─────────────────────────────────────────────────────────────

/**
 * A single atomic condition that compares one field against a value.
 * `field` uses dot-notation to reference the evaluation context
 * (e.g. "customer.tier", "order.total", "product.category").
 */
export const conditionLeafSchema = z.object({
  type: z.literal('leaf'),
  field: z.string().min(1),
  operator: ruleOperatorSchema,
  // Scalar for eq/ne/gt/gte/lt/lte/contains/not_contains/matches_regex.
  // Array of scalars for in/not_in (allowlist / denylist).
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]),
});

export type ConditionLeaf = z.infer<typeof conditionLeafSchema>;

// ── Condition group (recursive AND / OR) ─────────────────────────────────────

/**
 * A group of conditions joined by AND or OR logic (task 130).
 * Groups may be nested arbitrarily deep; the evaluator recurses.
 */
export type ConditionGroup = {
  type: 'group';
  logic: 'AND' | 'OR';
  conditions: Array<ConditionLeaf | ConditionGroup>;
};

// Zod cannot directly express recursive schemas without .lazy(); using it here.
export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    type: z.literal('group'),
    logic: z.enum(['AND', 'OR']),
    conditions: z.array(z.union([conditionLeafSchema, conditionGroupSchema])).min(1),
  }),
);

// Union of either a leaf or a group — top-level conditions field accepts both.
export const conditionSchema = z.union([conditionLeafSchema, conditionGroupSchema]);

export type Condition = z.infer<typeof conditionSchema>;

// ── Action ────────────────────────────────────────────────────────────────────

/**
 * An action taken when all conditions in the rule are satisfied.
 * `type` is a well-known string key interpreted by the evaluator
 * (e.g. 'apply_discount', 'add_points', 'set_tier', 'override_cap', 'block').
 * `params` carries action-specific payload; validated at evaluation time
 * against the concrete action handlers (task 129+).
 */
export const ruleActionSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  // Human-readable description included in the hit explanation (task 136)
  description: z.string().optional(),
});

export type RuleAction = z.infer<typeof ruleActionSchema>;

// ── Full rule definition ───────────────────────────────────────────────────────

/**
 * The complete definition stored as JSONB in `rules.definition_json`.
 *
 * evaluation_mode (task 133/134):
 *   serial   → stop at the first matched rule in priority order
 *   parallel → evaluate all rules, collect all matches
 *
 * priority (task 135):
 *   Lower number = higher precedence within the same group.
 *
 * group (task 135):
 *   Optional label; rules sharing a group are ordered by priority together.
 */
export const ruleDefinitionSchema = z.object({
  evaluation_mode: z.enum(['serial', 'parallel']),
  priority: z.number().int().min(0).default(100),
  group: z.string().optional(),
  // Top-level conditions: either a single leaf or a group
  conditions: conditionSchema,
  actions: z.array(ruleActionSchema).min(1),
  // Human-readable summary shown in admin UI and hit explanations (task 136)
  description: z.string().optional(),
});

export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;
