import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { users } from './users';

// Ticket types — determines required fields and routing (task 113):
//   return           → routed to fulfillment department
//   refund           → routed to accounting department
//   price_adjustment → routed to front_desk department
export const ticketTypeEnum = pgEnum('ticket_type', [
  'return',
  'refund',
  'price_adjustment',
]);

// open               → submitted by customer, not yet picked up
// in_progress        → checked in at counter by associate (task 111)
// pending_inspection → interrupted; item sent back for re-inspection (task 115)
// resolved           → outcome recorded (approved / rejected / adjusted)
// cancelled          → withdrawn before resolution
export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'pending_inspection',
  'resolved',
  'cancelled',
]);

// Departments that can own a ticket (mirrors triage routing logic, task 113)
export const ticketDepartmentEnum = pgEnum('ticket_department', [
  'front_desk',
  'fulfillment',
  'accounting',
]);

// Final outcome recorded when status → resolved (task 116)
export const ticketOutcomeEnum = pgEnum('ticket_outcome', [
  'approved',
  'rejected',
  'adjusted',
]);

export const afterSalesTickets = pgTable('after_sales_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),

  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'restrict' }),

  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),

  type: ticketTypeEnum('type').notNull(),

  status: ticketStatusEnum('status').notNull().default('open'),

  // Current owning department; updated on triage routing and reassignment (Q9)
  department: ticketDepartmentEnum('department').notNull(),

  // Associate currently handling the ticket; nullable until checked in (task 111)
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),

  // Required for price_adjustment type (spec); validated in Zod at task 106
  receiptReference: varchar('receipt_reference', { length: 255 }),

  // Refund/return eligibility window in days; default 30, manager may extend to 60 (Q3)
  windowDays: integer('window_days').notNull().default(30),

  // Set when status → resolved
  outcome: ticketOutcomeEnum('outcome'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AfterSalesTicket = typeof afterSalesTickets.$inferSelect;
export type NewAfterSalesTicket = typeof afterSalesTickets.$inferInsert;
