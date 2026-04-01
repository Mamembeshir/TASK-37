import { pgTable, uuid, varchar, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

// Immutable audit trail — no UPDATE or DELETE ever permitted on this table.
// DB-level enforcement (trigger + privilege revoke) added in task 147.
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Nullable: system-generated events (e.g. cart auto-cancel) have no human actor.
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),

  // Verb-noun action string, e.g. 'order.created', 'pickup.verify_failed',
  // 'ticket.reassigned', 'manager.override', 'cart.expired', 'rule.rolled_back'
  action: varchar('action', { length: 100 }).notNull(),

  // The type of the entity being acted on, e.g. 'order', 'ticket', 'review', 'user'
  entityType: varchar('entity_type', { length: 50 }).notNull(),

  // UUID of the specific entity instance
  entityId: uuid('entity_id').notNull(),

  // Full state snapshots — null when not applicable (e.g. creation has no before)
  before: jsonb('before'),
  after: jsonb('after'),

  // Duration in ms for ticket workflow nodes (checkin→triage→resolve) and
  // any timed operation. Null for instantaneous events.
  nodeDurationMs: integer('node_duration_ms'),

  // Immutable timestamp — set once at insert, never changed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
