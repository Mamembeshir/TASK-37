/**
 * Unit tests for TicketTimelineComponent.
 *
 * Strategy:
 *  - TicketTimelineComponent has NO inject() calls — it is a pure display component
 *    with @Input() bindings only.  No Angular DI mock is required; the class is
 *    instantiated directly and @Input properties are set as plain JS properties.
 *  - All helper methods are tested through the public API (label, icon, deptLabel,
 *    nodeClass, isActiveNode, activePing, time, dur).
 *  - Events ordering: the component stores events exactly as received — order tests
 *    verify the array reference is preserved without reordering.
 *
 * Coverage:
 *  - @Input defaults (assignedToId, ticketStatus)
 *  - isActiveNode(): active statuses (open/in_progress/pending_inspection), non-active
 *    statuses (resolved/cancelled), position guard (not-last → always false)
 *  - nodeClass(): correct base class from EVENT_TYPE_COLOR, scale-110 appended for
 *    active node, fallback to 'created' color for unknown eventType
 *  - activePing(): per-eventType ping colours
 *  - label(): EVENT_TYPE_LABEL lookup with unknown-type fallback
 *  - icon(): EVENT_TYPE_ICON lookup with 'created' fallback for unknown types
 *  - deptLabel(): DEPT_LABEL lookup with raw-value fallback
 *  - time(): locale time string formatting
 *  - dur (formatDuration ref): null/0 → '', seconds, minutes, hours
 *  - Events ordering: array order preserved, empty array handled, single event
 *  - nodeDurationMs: dur() correctly formats durations from events
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TicketTimelineComponent } from './ticket-timeline.component';
import {
  EVENT_TYPE_COLOR,
  EVENT_TYPE_ICON,
  EVENT_TYPE_LABEL,
  DEPT_LABEL,
  type TicketEvent,
} from '../../core/models/ticket.model';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TicketEvent> = {}): TicketEvent {
  return {
    id: 'evt-1',
    ticketId: 'tkt-1',
    actorId: 'actor-uuid-1',
    eventType: 'created',
    note: null,
    fromDept: null,
    toDept: null,
    nodeDurationMs: null,
    createdAt: '2025-03-01T10:00:00Z',
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeComponent(
  events: TicketEvent[] = [],
  ticketStatus           = '',
  assignedToId: string | null = null,
): TicketTimelineComponent {
  const component = new TicketTimelineComponent();
  component.events        = events;
  component.ticketStatus  = ticketStatus;
  component.assignedToId  = assignedToId;
  return component;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TicketTimelineComponent', () => {
  // ── @Input defaults ────────────────────────────────────────────────────────

  describe('@Input defaults', () => {
    it('assignedToId defaults to null', () => {
      const component = new TicketTimelineComponent();
      expect(component.assignedToId).toBeNull();
    });

    it('ticketStatus defaults to empty string', () => {
      const component = new TicketTimelineComponent();
      expect(component.ticketStatus).toBe('');
    });
  });

  // ── isActiveNode() ────────────────────────────────────────────────────────

  describe('isActiveNode()', () => {
    it('returns true when last=true and ticketStatus is "open"', () => {
      const component = makeComponent([], 'open');
      expect(component.isActiveNode(0, true)).toBe(true);
    });

    it('returns true when last=true and ticketStatus is "in_progress"', () => {
      const component = makeComponent([], 'in_progress');
      expect(component.isActiveNode(0, true)).toBe(true);
    });

    it('returns true when last=true and ticketStatus is "pending_inspection"', () => {
      const component = makeComponent([], 'pending_inspection');
      expect(component.isActiveNode(0, true)).toBe(true);
    });

    it('returns false when last=false regardless of active status', () => {
      const component = makeComponent([], 'open');
      expect(component.isActiveNode(0, false)).toBe(false);
    });

    it('returns false when last=false with in_progress status', () => {
      const component = makeComponent([], 'in_progress');
      expect(component.isActiveNode(2, false)).toBe(false);
    });

    it('returns false when last=true and ticketStatus is "resolved"', () => {
      const component = makeComponent([], 'resolved');
      expect(component.isActiveNode(0, true)).toBe(false);
    });

    it('returns false when last=true and ticketStatus is "cancelled"', () => {
      const component = makeComponent([], 'cancelled');
      expect(component.isActiveNode(0, true)).toBe(false);
    });

    it('returns false when ticketStatus is empty string', () => {
      const component = makeComponent([], '');
      expect(component.isActiveNode(0, true)).toBe(false);
    });
  });

  // ── nodeClass() ───────────────────────────────────────────────────────────

  describe('nodeClass()', () => {
    it('returns the EVENT_TYPE_COLOR base class for the event type', () => {
      const component = makeComponent([], 'resolved');
      const event = makeEvent({ eventType: 'checked_in' });
      const cls = component.nodeClass(event, 0, false);
      expect(cls).toBe(EVENT_TYPE_COLOR['checked_in']);
    });

    it('appends "scale-110" for the active (last + active status) node', () => {
      const component = makeComponent([], 'open');
      const event = makeEvent({ eventType: 'checked_in' });
      const cls = component.nodeClass(event, 0, true);
      expect(cls).toContain('scale-110');
    });

    it('does not append "scale-110" for non-active nodes', () => {
      const component = makeComponent([], 'open');
      const event = makeEvent({ eventType: 'checked_in' });
      const cls = component.nodeClass(event, 0, false);
      expect(cls).not.toContain('scale-110');
    });

    it('uses "created" color fallback for an unknown eventType', () => {
      const component = makeComponent([], 'resolved');
      const event = makeEvent({ eventType: 'unknown_event' });
      const cls = component.nodeClass(event, 0, false);
      expect(cls).toBe(EVENT_TYPE_COLOR['created']);
    });

    it('active node class starts with the correct base color for resolved event type', () => {
      const component = makeComponent([], 'in_progress');
      const event = makeEvent({ eventType: 'resolved' });
      const cls = component.nodeClass(event, 0, true);
      expect(cls).toContain(EVENT_TYPE_COLOR['resolved']);
    });
  });

  // ── activePing() ──────────────────────────────────────────────────────────

  describe('activePing()', () => {
    it('"interrupted" → "bg-red-500"', () => {
      const component = makeComponent();
      expect(component.activePing('interrupted')).toBe('bg-red-500');
    });

    it('"checked_in" → "bg-sky-500"', () => {
      const component = makeComponent();
      expect(component.activePing('checked_in')).toBe('bg-sky-500');
    });

    it('"triaged" → "bg-violet-500"', () => {
      const component = makeComponent();
      expect(component.activePing('triaged')).toBe('bg-violet-500');
    });

    it('any other event type → "bg-zinc-500"', () => {
      const component = makeComponent();
      expect(component.activePing('resolved')).toBe('bg-zinc-500');
    });

    it('"created" → "bg-zinc-500" (falls through to default)', () => {
      const component = makeComponent();
      expect(component.activePing('created')).toBe('bg-zinc-500');
    });
  });

  // ── label() ───────────────────────────────────────────────────────────────

  describe('label()', () => {
    it('"checked_in" → "Checked In"', () => {
      const component = makeComponent();
      expect(component.label('checked_in')).toBe(EVENT_TYPE_LABEL['checked_in']);
    });

    it('"resolved" → "Resolved"', () => {
      const component = makeComponent();
      expect(component.label('resolved')).toBe('Resolved');
    });

    it('"triaged" → "Triaged"', () => {
      const component = makeComponent();
      expect(component.label('triaged')).toBe('Triaged');
    });

    it('"reassigned" → "Reassigned"', () => {
      const component = makeComponent();
      expect(component.label('reassigned')).toBe('Reassigned');
    });

    it('"interrupted" → "Interrupted"', () => {
      const component = makeComponent();
      expect(component.label('interrupted')).toBe('Interrupted');
    });

    it('unknown event type is returned as-is', () => {
      const component = makeComponent();
      expect(component.label('mystery_event')).toBe('mystery_event');
    });
  });

  // ── icon() ────────────────────────────────────────────────────────────────

  describe('icon()', () => {
    it('"checked_in" returns the correct SVG path', () => {
      const component = makeComponent();
      expect(component.icon('checked_in')).toBe(EVENT_TYPE_ICON['checked_in']);
    });

    it('"resolved" returns the correct SVG path', () => {
      const component = makeComponent();
      expect(component.icon('resolved')).toBe(EVENT_TYPE_ICON['resolved']);
    });

    it('"reassigned" returns the correct SVG path', () => {
      const component = makeComponent();
      expect(component.icon('reassigned')).toBe(EVENT_TYPE_ICON['reassigned']);
    });

    it('unknown event type falls back to the "created" SVG path', () => {
      const component = makeComponent();
      expect(component.icon('unknown_event')).toBe(EVENT_TYPE_ICON['created']);
    });

    it('"created" returns its own SVG path', () => {
      const component = makeComponent();
      expect(component.icon('created')).toBe(EVENT_TYPE_ICON['created']);
    });
  });

  // ── deptLabel() ───────────────────────────────────────────────────────────

  describe('deptLabel()', () => {
    it('"front_desk" → "Front Desk"', () => {
      const component = makeComponent();
      expect(component.deptLabel('front_desk')).toBe('Front Desk');
    });

    it('"fulfillment" → "Fulfillment"', () => {
      const component = makeComponent();
      expect(component.deptLabel('fulfillment')).toBe('Fulfillment');
    });

    it('"returns" → "Returns"', () => {
      const component = makeComponent();
      expect(component.deptLabel('returns')).toBe('Returns');
    });

    it('"warehouse" → "Warehouse"', () => {
      const component = makeComponent();
      expect(component.deptLabel('warehouse')).toBe('Warehouse');
    });

    it('"accounting" → "Accounting"', () => {
      const component = makeComponent();
      expect(component.deptLabel('accounting')).toBe(DEPT_LABEL['accounting']);
    });

    it('unknown dept is returned as-is', () => {
      const component = makeComponent();
      expect(component.deptLabel('mystery_dept')).toBe('mystery_dept');
    });
  });

  // ── time() ────────────────────────────────────────────────────────────────

  describe('time()', () => {
    it('returns a non-empty string for a valid ISO timestamp', () => {
      const component = makeComponent();
      const result = component.time('2025-03-01T14:30:00Z');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('returns a different string for different timestamps', () => {
      const component = makeComponent();
      const t1 = component.time('2025-03-01T10:00:00Z');
      const t2 = component.time('2025-03-01T22:00:00Z');
      expect(t1).not.toBe(t2);
    });
  });

  // ── dur (formatDuration reference) ────────────────────────────────────────

  describe('dur (formatDuration)', () => {
    it('null → empty string', () => {
      const component = makeComponent();
      expect(component.dur(null)).toBe('');
    });

    it('0 ms → empty string', () => {
      const component = makeComponent();
      expect(component.dur(0)).toBe('');
    });

    it('30 000 ms → "30s"', () => {
      const component = makeComponent();
      expect(component.dur(30_000)).toBe('30s');
    });

    it('90 000 ms → "1m 30s"', () => {
      const component = makeComponent();
      expect(component.dur(90_000)).toBe('1m 30s');
    });

    it('3 600 000 ms → "1h"', () => {
      const component = makeComponent();
      expect(component.dur(3_600_000)).toBe('1h');
    });

    it('5 400 000 ms → "1h 30m"', () => {
      const component = makeComponent();
      expect(component.dur(5_400_000)).toBe('1h 30m');
    });

    it('60 000 ms → "1m" (no trailing "0s")', () => {
      const component = makeComponent();
      expect(component.dur(60_000)).toBe('1m');
    });
  });

  // ── Events ordering ───────────────────────────────────────────────────────

  describe('events ordering', () => {
    it('preserves the order of the events array as passed', () => {
      const e1 = makeEvent({ id: 'evt-1', eventType: 'created',   createdAt: '2025-03-01T08:00:00Z' });
      const e2 = makeEvent({ id: 'evt-2', eventType: 'checked_in', createdAt: '2025-03-01T09:00:00Z' });
      const e3 = makeEvent({ id: 'evt-3', eventType: 'triaged',    createdAt: '2025-03-01T10:00:00Z' });
      const component = makeComponent([e1, e2, e3], 'in_progress');
      expect(component.events[0].id).toBe('evt-1');
      expect(component.events[1].id).toBe('evt-2');
      expect(component.events[2].id).toBe('evt-3');
    });

    it('an empty events array leaves the component in a valid state', () => {
      const component = makeComponent([], 'open');
      expect(component.events).toHaveLength(0);
      // isActiveNode can still be called without throwing
      expect(() => component.isActiveNode(0, true)).not.toThrow();
    });

    it('a single event is accessible at index 0', () => {
      const event = makeEvent({ eventType: 'created' });
      const component = makeComponent([event], 'resolved');
      expect(component.events).toHaveLength(1);
      expect(component.events[0].eventType).toBe('created');
    });

    it('events array reference is the same as the one passed in', () => {
      const events = [makeEvent(), makeEvent({ id: 'evt-2' })];
      const component = makeComponent(events, 'open');
      expect(component.events).toBe(events);
    });
  });

  // ── Status changes — isActiveNode behaviour across full lifecycle ──────────

  describe('status changes — full ticket lifecycle', () => {
    const event = makeEvent({ eventType: 'created' });

    it('last event is active when status is open', () => {
      const component = makeComponent([event], 'open');
      expect(component.isActiveNode(0, true)).toBe(true);
    });

    it('last event is active when status transitions to in_progress', () => {
      const component = makeComponent([event], 'in_progress');
      expect(component.isActiveNode(0, true)).toBe(true);
    });

    it('last event is active during pending_inspection', () => {
      const component = makeComponent([event], 'pending_inspection');
      expect(component.isActiveNode(0, true)).toBe(true);
    });

    it('last event is NOT active once status reaches resolved', () => {
      const component = makeComponent([event], 'resolved');
      expect(component.isActiveNode(0, true)).toBe(false);
    });

    it('last event is NOT active once status is cancelled', () => {
      const component = makeComponent([event], 'cancelled');
      expect(component.isActiveNode(0, true)).toBe(false);
    });

    it('earlier events are never active even in open status', () => {
      const events = [
        makeEvent({ id: 'evt-1', eventType: 'created' }),
        makeEvent({ id: 'evt-2', eventType: 'checked_in' }),
      ];
      const component = makeComponent(events, 'open');
      // index 0 is NOT the last event
      expect(component.isActiveNode(0, false)).toBe(false);
      // index 1 IS the last event
      expect(component.isActiveNode(1, true)).toBe(true);
    });
  });

  // ── Node durations ─────────────────────────────────────────────────────────

  describe('node durations via dur()', () => {
    it('returns empty string for an event with nodeDurationMs=null', () => {
      const component = makeComponent();
      const event = makeEvent({ nodeDurationMs: null });
      expect(component.dur(event.nodeDurationMs)).toBe('');
    });

    it('formats a short node duration correctly', () => {
      const component = makeComponent();
      const event = makeEvent({ nodeDurationMs: 45_000 }); // 45 seconds
      expect(component.dur(event.nodeDurationMs)).toBe('45s');
    });

    it('formats a long node duration correctly', () => {
      const component = makeComponent();
      const event = makeEvent({ nodeDurationMs: 7_200_000 }); // 2 hours
      expect(component.dur(event.nodeDurationMs)).toBe('2h');
    });

    it('formats sub-hour mixed duration correctly', () => {
      const component = makeComponent();
      const event = makeEvent({ nodeDurationMs: 125_000 }); // 2m 5s
      expect(component.dur(event.nodeDurationMs)).toBe('2m 5s');
    });
  });

  // ── Department transitions ─────────────────────────────────────────────────

  describe('department transition events', () => {
    it('fromDept and toDept are accessible on reassign events', () => {
      const event = makeEvent({
        eventType: 'reassigned',
        fromDept: 'front_desk',
        toDept: 'returns',
      });
      const component = makeComponent([event], 'in_progress');
      expect(component.events[0].fromDept).toBe('front_desk');
      expect(component.events[0].toDept).toBe('returns');
    });

    it('deptLabel renders both dept codes correctly', () => {
      const component = makeComponent();
      expect(component.deptLabel('front_desk')).toBe('Front Desk');
      expect(component.deptLabel('returns')).toBe('Returns');
    });

    it('null fromDept/toDept leaves event without dept transition', () => {
      const event = makeEvent({ fromDept: null, toDept: null });
      const component = makeComponent([event]);
      expect(component.events[0].fromDept).toBeNull();
      expect(component.events[0].toDept).toBeNull();
    });
  });
});
