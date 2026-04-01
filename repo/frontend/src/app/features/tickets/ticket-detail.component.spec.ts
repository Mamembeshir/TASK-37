/**
 * Unit tests for TicketDetailComponent.
 *
 * Strategy:
 *  - vi.mock('@angular/core') replaces inject() so TicketService and ActivatedRoute
 *    resolve from mocks.  Signals keep their real implementations.
 *  - ticketSvc.get() returns an Observable; mocked with of() / throwError().
 *  - ngOnInit() calls `void this.load()` (fire-and-forget async).  We call
 *    ngOnInit() and then drain microtasks with flushPromises() before asserting.
 *
 * Coverage:
 *  - Initial signal state
 *  - ngOnInit(): reads route param → sets ticketId; calls load()
 *  - load() success: sets ticket, loading→false, loadError stays null
 *  - load() 404: loadError='Ticket not found.', loading→false
 *  - load() other errors: loadError='Could not load ticket.', loading→false
 *  - Helper methods: typeLabel, statusLabel, statusBadge, outcomeBadge, deptLabel, formatDate
 *  - formatDuration exposed on component: null/zero/'', 30s, 1m, 1h
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TicketDetailComponent } from './ticket-detail.component';
import { TicketService } from '../../core/services/ticket.service';
import { ToastService } from '../../core/services/toast.service';
import {
  TICKET_STATUS_BADGE,
  TICKET_OUTCOME_BADGE,
  type Ticket,
} from '../../core/models/ticket.model';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tkt-uuid-0001',
    orderId: 'ord-uuid-0001',
    customerId: 'user-1',
    type: 'return',
    status: 'open',
    department: 'returns',
    assignedTo: null,
    receiptReference: null,
    windowDays: 30,
    outcome: null,
    resolvedAt: null,
    createdAt: '2025-03-01T09:00:00Z',
    updatedAt: '2025-03-01T09:00:00Z',
    events: [],
    ...overrides,
  };
}

function makeTicketSvc(ticket: Ticket = makeTicket()) {
  return { get: vi.fn().mockReturnValue(of(ticket)) };
}

function makeRoute(id: string | null = 'tkt-uuid-0001') {
  return {
    snapshot: { paramMap: { get: vi.fn().mockReturnValue(id) } },
  };
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
}

function makeComponent(
  ticketSvc = makeTicketSvc(),
  route     = makeRoute(),
  toast     = makeToast(),
) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === TicketService)  return ticketSvc;
    if (token === ActivatedRoute) return route;
    if (token === ToastService)   return toast;
    return undefined;
  });
  const component = new TicketDetailComponent();
  return { component, ticketSvc, route, toast };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TicketDetailComponent', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('ticketId starts as an empty string', () => {
      const { component } = makeComponent();
      expect(component.ticketId()).toBe('');
    });

    it('ticket starts null', () => {
      const { component } = makeComponent();
      expect(component.ticket()).toBeNull();
    });

    it('loading starts true', () => {
      const { component } = makeComponent();
      expect(component.loading()).toBe(true);
    });

    it('loadError starts null', () => {
      const { component } = makeComponent();
      expect(component.loadError()).toBeNull();
    });
  });

  // ── ngOnInit() ────────────────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('sets ticketId from the route param', async () => {
      const { component } = makeComponent(makeTicketSvc(), makeRoute('abc-123'));
      component.ngOnInit();
      expect(component.ticketId()).toBe('abc-123');
    });

    it('sets ticketId to empty string when route param is null', async () => {
      const { component } = makeComponent(makeTicketSvc(), makeRoute(null));
      component.ngOnInit();
      expect(component.ticketId()).toBe('');
    });

    it('calls ticketSvc.get with the ticketId', async () => {
      const ticketSvc = makeTicketSvc();
      const { component } = makeComponent(ticketSvc, makeRoute('tkt-xyz'));
      component.ngOnInit();
      await flushPromises();
      expect(ticketSvc.get).toHaveBeenCalledWith('tkt-xyz');
    });

    it('ticketId is set synchronously (before async load resolves)', () => {
      const { component } = makeComponent(makeTicketSvc(), makeRoute('sync-id'));
      component.ngOnInit();
      // No await — ticketId must be set immediately
      expect(component.ticketId()).toBe('sync-id');
    });
  });

  // ── load() — success path ──────────────────────────────────────────────────

  describe('load() — success', () => {
    it('sets the ticket signal from the API response', async () => {
      const ticket = makeTicket({ type: 'refund', status: 'in_progress' });
      const { component } = makeComponent(makeTicketSvc(ticket));
      component.ngOnInit();
      await flushPromises();
      expect(component.ticket()).toEqual(ticket);
    });

    it('sets loading to false after success', async () => {
      const { component } = makeComponent();
      component.ngOnInit();
      await flushPromises();
      expect(component.loading()).toBe(false);
    });

    it('loadError remains null after success', async () => {
      const { component } = makeComponent();
      component.ngOnInit();
      await flushPromises();
      expect(component.loadError()).toBeNull();
    });
  });

  // ── load() — 404 error ─────────────────────────────────────────────────────

  describe('load() — 404 error', () => {
    function make404Svc() {
      const svc = makeTicketSvc();
      svc.get.mockReturnValue(throwError(() => ({ status: 404 })));
      return svc;
    }

    it('sets loadError to "Ticket not found." on a 404', async () => {
      const { component } = makeComponent(make404Svc());
      component.ngOnInit();
      await flushPromises();
      expect(component.loadError()).toBe('Ticket not found.');
    });

    it('sets loading to false after a 404', async () => {
      const { component } = makeComponent(make404Svc());
      component.ngOnInit();
      await flushPromises();
      expect(component.loading()).toBe(false);
    });

    it('ticket remains null after a 404', async () => {
      const { component } = makeComponent(make404Svc());
      component.ngOnInit();
      await flushPromises();
      expect(component.ticket()).toBeNull();
    });
  });

  // ── load() — other errors ──────────────────────────────────────────────────

  describe('load() — other errors', () => {
    it('sets loadError to "Could not load ticket. Please try again." for a 500', async () => {
      const svc = makeTicketSvc();
      svc.get.mockReturnValue(throwError(() => ({ status: 500 })));
      const { component } = makeComponent(svc);
      component.ngOnInit();
      await flushPromises();
      expect(component.loadError()).toBe('Could not load ticket. Please try again.');
    });

    it('sets loadError to "Could not load ticket." for a 403', async () => {
      const svc = makeTicketSvc();
      svc.get.mockReturnValue(throwError(() => ({ status: 403 })));
      const { component } = makeComponent(svc);
      component.ngOnInit();
      await flushPromises();
      expect(component.loadError()).toBe('Could not load ticket. Please try again.');
    });

    it('sets loading to false on a non-404 error', async () => {
      const svc = makeTicketSvc();
      svc.get.mockReturnValue(throwError(() => ({ status: 500 })));
      const { component } = makeComponent(svc);
      component.ngOnInit();
      await flushPromises();
      expect(component.loading()).toBe(false);
    });
  });

  // ── typeLabel() ───────────────────────────────────────────────────────────

  describe('typeLabel()', () => {
    it('"return" → "Return"', () => {
      const { component } = makeComponent();
      expect(component.typeLabel('return')).toBe('Return');
    });

    it('"refund" → "Refund"', () => {
      const { component } = makeComponent();
      expect(component.typeLabel('refund')).toBe('Refund');
    });

    it('"price_adjustment" → "Price Adjustment"', () => {
      const { component } = makeComponent();
      expect(component.typeLabel('price_adjustment')).toBe('Price Adjustment');
    });

    it('unknown type is returned as-is', () => {
      const { component } = makeComponent();
      expect(component.typeLabel('mystery_type')).toBe('mystery_type');
    });
  });

  // ── statusLabel() ─────────────────────────────────────────────────────────

  describe('statusLabel()', () => {
    it('"open" → "Open"', () => {
      const { component } = makeComponent();
      expect(component.statusLabel('open')).toBe('Open');
    });

    it('"in_progress" → "In Progress"', () => {
      const { component } = makeComponent();
      expect(component.statusLabel('in_progress')).toBe('In Progress');
    });

    it('"pending_inspection" → "Pending Inspection"', () => {
      const { component } = makeComponent();
      expect(component.statusLabel('pending_inspection')).toBe('Pending Inspection');
    });

    it('"resolved" → "Resolved"', () => {
      const { component } = makeComponent();
      expect(component.statusLabel('resolved')).toBe('Resolved');
    });

    it('"cancelled" → "Cancelled"', () => {
      const { component } = makeComponent();
      expect(component.statusLabel('cancelled')).toBe('Cancelled');
    });

    it('unknown status is returned as-is', () => {
      const { component } = makeComponent();
      expect(component.statusLabel('unknown_status')).toBe('unknown_status');
    });
  });

  // ── statusBadge() ─────────────────────────────────────────────────────────

  describe('statusBadge()', () => {
    it('"open" badge contains the warm accent colour', () => {
      const { component } = makeComponent();
      expect(component.statusBadge('open')).toContain('#c4832a');
    });

    it('"in_progress" badge contains sky', () => {
      const { component } = makeComponent();
      expect(component.statusBadge('in_progress')).toContain('sky');
    });

    it('"pending_inspection" badge contains violet', () => {
      const { component } = makeComponent();
      expect(component.statusBadge('pending_inspection')).toContain('violet');
    });

    it('"resolved" badge contains the warm accent colour', () => {
      const { component } = makeComponent();
      expect(component.statusBadge('resolved')).toContain('#c4832a');
    });

    it('"cancelled" badge contains zinc', () => {
      const { component } = makeComponent();
      expect(component.statusBadge('cancelled')).toContain('zinc');
    });

    it('returns the same value as TICKET_STATUS_BADGE lookup', () => {
      const { component } = makeComponent();
      expect(component.statusBadge('open')).toBe(TICKET_STATUS_BADGE['open']);
    });
  });

  // ── outcomeBadge() ────────────────────────────────────────────────────────

  describe('outcomeBadge()', () => {
    it('"approved" badge contains the warm accent colour', () => {
      const { component } = makeComponent();
      expect(component.outcomeBadge('approved')).toContain('#c4832a');
    });

    it('"rejected" badge contains red', () => {
      const { component } = makeComponent();
      expect(component.outcomeBadge('rejected')).toContain('red');
    });

    it('"adjusted" badge contains the warm accent colour', () => {
      const { component } = makeComponent();
      expect(component.outcomeBadge('adjusted')).toContain('#c4832a');
    });

    it('returns the same value as TICKET_OUTCOME_BADGE lookup', () => {
      const { component } = makeComponent();
      expect(component.outcomeBadge('rejected')).toBe(TICKET_OUTCOME_BADGE['rejected']);
    });
  });

  // ── deptLabel() ───────────────────────────────────────────────────────────

  describe('deptLabel()', () => {
    it('"front_desk" → "Front Desk"', () => {
      const { component } = makeComponent();
      expect(component.deptLabel('front_desk')).toBe('Front Desk');
    });

    it('"fulfillment" → "Fulfillment"', () => {
      const { component } = makeComponent();
      expect(component.deptLabel('fulfillment')).toBe('Fulfillment');
    });

    it('"returns" → "Returns"', () => {
      const { component } = makeComponent();
      expect(component.deptLabel('returns')).toBe('Returns');
    });

    it('"warehouse" → "Warehouse"', () => {
      const { component } = makeComponent();
      expect(component.deptLabel('warehouse')).toBe('Warehouse');
    });

    it('unknown dept is returned as-is', () => {
      const { component } = makeComponent();
      expect(component.deptLabel('mystery_dept')).toBe('mystery_dept');
    });
  });

  // ── formatDate() ──────────────────────────────────────────────────────────

  describe('formatDate()', () => {
    it('returns a non-empty string for a valid ISO date', () => {
      const { component } = makeComponent();
      const result = component.formatDate('2025-03-15T14:30:00Z');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('includes the year in the formatted output', () => {
      const { component } = makeComponent();
      const result = component.formatDate('2025-03-15T14:30:00Z');
      expect(result).toContain('2025');
    });
  });

  // ── formatDuration exposed on component ───────────────────────────────────

  describe('formatDuration exposed on component', () => {
    it('null → empty string', () => {
      const { component } = makeComponent();
      expect(component.formatDuration(null)).toBe('');
    });

    it('0 ms → empty string', () => {
      const { component } = makeComponent();
      expect(component.formatDuration(0)).toBe('');
    });

    it('30 000 ms → "30s"', () => {
      const { component } = makeComponent();
      expect(component.formatDuration(30_000)).toBe('30s');
    });

    it('60 000 ms → "1m"', () => {
      const { component } = makeComponent();
      expect(component.formatDuration(60_000)).toBe('1m');
    });

    it('3 600 000 ms → "1h"', () => {
      const { component } = makeComponent();
      expect(component.formatDuration(3_600_000)).toBe('1h');
    });
  });
});
