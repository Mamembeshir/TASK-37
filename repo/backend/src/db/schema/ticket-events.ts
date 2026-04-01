import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { afterSalesTickets, ticketDepartmentEnum } from './after-sales-tickets';
import { users } from './users';

// Every state transition and staff action on a ticket appends one row here.
// Rows are never updated — this is the immutable timeline (Q14).
export const ticketEventTypeEnum = pgEnum('ticket_event_type', [
  'checked_in',        // associate checks in return at counter (task 111)
  'triaged',           // triage answers submitted, department assigned (task 112)
  'reassigned',        // moved to different department by supervisor (task 114, Q9)
  'interrupted',       // flagged for re-inspection / retest (task 115)
  'note_added',        // staff added a freeform note
  'resolved',          // ticket closed with outcome (task 116)
  'cancelled',         // ticket withdrawn before resolution
]);

export const ticketEvents = pgTable('ticket_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => afterSalesTickets.id, { onDelete: 'cascade' }),

  // Nullable: future system-generated events may have no human actor
  actorId: uuid('actor_id')
    .references(() => users.id, { onDelete: 'set null' }),

  eventType: ticketEventTypeEnum('event_type').notNull(),

  // Freeform staff note — stored AES-256-GCM encrypted at rest (task 41).
  // Column type is text (unbounded) to hold the encrypted format:
  // iv_hex:authTag_hex:ciphertext_hex (see lib/crypto.ts).
  //
  // Write path: encryptNullable(rawNote)   → store result
  // Read path:  decryptNullable(row.note)  → return plaintext to caller
  //
  // Never expose the raw (encrypted) column value in API responses.
  note: text('note'),

  // Populated only for 'reassigned' events (Q9)
  fromDept: ticketDepartmentEnum('from_dept'),
  toDept: ticketDepartmentEnum('to_dept'),

  // Duration in milliseconds from previous node start to this event.
  // Used to build the timeline view with per-node durations (Q14, task 117).
  nodeDurationMs: integer('node_duration_ms'),

  // Immutable insert timestamp — never updated
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TicketEvent = typeof ticketEvents.$inferSelect;
export type NewTicketEvent = typeof ticketEvents.$inferInsert;
