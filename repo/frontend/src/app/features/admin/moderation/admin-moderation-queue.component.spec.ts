/**
 * Unit tests for AdminModerationQueueComponent.
 *
 * Strategy: vi.mock('@angular/core') replaces `inject` so the component can
 * be instantiated without TestBed.  Signals stay real.
 *
 * Coverage:
 *  - Initial signal state
 *  - load() — success, API error
 *  - filtered() computed — filters by moderationStatus
 *  - pendingCount() computed
 *  - openAction / closeAction
 *  - confirmAction — approve success, reject (without note → error, with note → success)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminModerationQueueComponent } from './admin-moderation-queue.component';
import type { ModerationItem } from './admin-moderation-queue.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PENDING_ITEM: ModerationItem = {
  id: 'r-1',
  orderId: 'o-1',
  customerId: 'c-1',
  body: 'Great product, loved it!',
  isFollowup: false,
  moderationStatus: 'pending',
  flagReason: null,
  submittedAt: '2024-01-01T00:00:00.000Z',
  resolvedAt: null,
  resolvedByUsername: null,
  resolvedNote: null,
  imageCount: 0,
};

const FLAGGED_ITEM: ModerationItem = {
  ...PENDING_ITEM,
  id: 'r-2',
  moderationStatus: 'flagged',
  flagReason: 'contains banned term',
};

const APPROVED_ITEM: ModerationItem = {
  ...PENDING_ITEM,
  id: 'r-3',
  moderationStatus: 'approved',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApiSpy() {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
}

function makeToastSpy() {
  return { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
}

function makeComponent(api = makeApiSpy(), toast = makeToastSpy()) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === ApiService)  return api;
    if (token === ToastService) return toast;
    return undefined;
  });
  const component = new AdminModerationQueueComponent();
  return { component, api, toast };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminModerationQueueComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('loading is true before any data', () => {
      const { component } = makeComponent();
      expect(component.loading()).toBe(true);
    });

    it('items is empty before load', () => {
      const { component } = makeComponent();
      expect(component.items()).toEqual([]);
    });

    it('filterStatus defaults to pending', () => {
      const { component } = makeComponent();
      expect(component.filterStatus()).toBe('pending');
    });

    it('actionTarget is null initially', () => {
      const { component } = makeComponent();
      expect(component.actionTarget()).toBeNull();
    });
  });

  // ── load ───────────────────────────────────────────────────────────────────

  describe('load()', () => {
    it('calls api.get /admin/moderation on init', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      expect(api.get).toHaveBeenCalledWith('/admin/moderation', expect.any(Object));
    });

    it('populates items signal on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM, FLAGGED_ITEM]));
      await component.ngOnInit();
      expect(component.items()).toHaveLength(2);
    });

    it('sets loading false after success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('sets items to [] on API error', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(throwError(() => new Error('network')));
      await component.ngOnInit();
      expect(component.items()).toEqual([]);
    });

    it('sets loading false on API error', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(throwError(() => new Error('network')));
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });
  });

  // ── filtered() computed ────────────────────────────────────────────────────

  describe('filtered()', () => {
    it('returns only pending items when filterStatus is pending', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM, FLAGGED_ITEM, APPROVED_ITEM]));
      await component.ngOnInit();
      component.filterStatus.set('pending');
      expect(component.filtered()).toEqual([PENDING_ITEM]);
    });

    it('returns only flagged items when filterStatus is flagged', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM, FLAGGED_ITEM, APPROVED_ITEM]));
      await component.ngOnInit();
      component.filterStatus.set('flagged');
      expect(component.filtered()).toEqual([FLAGGED_ITEM]);
    });

    it('returns only approved items when filterStatus is approved', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM, FLAGGED_ITEM, APPROVED_ITEM]));
      await component.ngOnInit();
      component.filterStatus.set('approved');
      expect(component.filtered()).toEqual([APPROVED_ITEM]);
    });

    it('returns all items when filterStatus is empty string', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM, FLAGGED_ITEM, APPROVED_ITEM]));
      await component.ngOnInit();
      component.filterStatus.set('');
      expect(component.filtered()).toHaveLength(3);
    });
  });

  // ── pendingCount() computed ────────────────────────────────────────────────

  describe('pendingCount()', () => {
    it('counts both pending and flagged items', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM, FLAGGED_ITEM, APPROVED_ITEM]));
      await component.ngOnInit();
      expect(component.pendingCount()).toBe(2);
    });

    it('returns 0 when only approved items exist', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([APPROVED_ITEM]));
      await component.ngOnInit();
      expect(component.pendingCount()).toBe(0);
    });
  });

  // ── openAction / closeAction ───────────────────────────────────────────────

  describe('openAction / closeAction', () => {
    it('openAction sets actionTarget and actionType', () => {
      const { component } = makeComponent();
      component.openAction(PENDING_ITEM, 'approve');
      expect(component.actionTarget()).toEqual(PENDING_ITEM);
      expect(component.actionType()).toBe('approve');
    });

    it('openAction resets actionNote and actionError', () => {
      const { component } = makeComponent();
      component.actionNote = 'old note';
      component.actionError.set('old error');
      component.openAction(PENDING_ITEM, 'reject');
      expect(component.actionNote).toBe('');
      expect(component.actionError()).toBeNull();
    });

    it('closeAction clears actionTarget and actionError', () => {
      const { component } = makeComponent();
      component.openAction(PENDING_ITEM, 'approve');
      component.actionError.set('some error');
      component.closeAction();
      expect(component.actionTarget()).toBeNull();
      expect(component.actionError()).toBeNull();
    });
  });

  // ── confirmAction ──────────────────────────────────────────────────────────

  describe('confirmAction — approve', () => {
    it('calls api.post to /approve endpoint', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      component.openAction(PENDING_ITEM, 'approve');
      const approved = { ...PENDING_ITEM, moderationStatus: 'approved' as const };
      api.post.mockReturnValue(of(approved));

      await component.confirmAction();

      expect(api.post).toHaveBeenCalledWith(
        `/admin/moderation/${PENDING_ITEM.id}/approve`,
        expect.any(Object),
      );
    });

    it('updates the item in the list on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      component.openAction(PENDING_ITEM, 'approve');
      const approved = { ...PENDING_ITEM, moderationStatus: 'approved' as const };
      api.post.mockReturnValue(of(approved));

      await component.confirmAction();

      expect(component.items()[0]?.moderationStatus).toBe('approved');
    });

    it('closes the action modal on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      component.openAction(PENDING_ITEM, 'approve');
      api.post.mockReturnValue(of({ ...PENDING_ITEM, moderationStatus: 'approved' as const }));

      await component.confirmAction();

      expect(component.actionTarget()).toBeNull();
    });

    it('calls toast.success on approve', async () => {
      const { component, api, toast } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      component.openAction(PENDING_ITEM, 'approve');
      api.post.mockReturnValue(of({ ...PENDING_ITEM, moderationStatus: 'approved' as const }));

      await component.confirmAction();

      expect(toast.success).toHaveBeenCalled();
    });

    it('sets actionError on API failure', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([PENDING_ITEM]));
      await component.ngOnInit();
      component.openAction(PENDING_ITEM, 'approve');
      api.post.mockReturnValue(throwError(() => ({ error: { error: 'Server error' } })));

      await component.confirmAction();

      expect(component.actionError()).toBeTruthy();
    });
  });

  describe('confirmAction — reject', () => {
    it('sets actionError when note is empty', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([FLAGGED_ITEM]));
      await component.ngOnInit();
      component.openAction(FLAGGED_ITEM, 'reject');
      component.actionNote = ''; // no note

      await component.confirmAction();

      expect(component.actionError()).toBeTruthy();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('calls api.post to /reject endpoint with note', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([FLAGGED_ITEM]));
      await component.ngOnInit();
      component.openAction(FLAGGED_ITEM, 'reject');
      component.actionNote = 'violates policy';
      const rejected = { ...FLAGGED_ITEM, moderationStatus: 'flagged' as const };
      api.post.mockReturnValue(of(rejected));

      await component.confirmAction();

      expect(api.post).toHaveBeenCalledWith(
        `/admin/moderation/${FLAGGED_ITEM.id}/reject`,
        { note: 'violates policy' },
      );
    });

    it('updates the item in the list on reject success', async () => {
      const { component, api } = makeComponent();
      const pendingItem = { ...PENDING_ITEM };
      api.get.mockReturnValue(of([pendingItem]));
      await component.ngOnInit();
      component.openAction(pendingItem, 'reject');
      component.actionNote = 'spam content';
      const rejected = { ...pendingItem, moderationStatus: 'flagged' as const };
      api.post.mockReturnValue(of(rejected));

      await component.confirmAction();

      expect(component.items()[0]?.moderationStatus).toBe('flagged');
    });

    it('calls toast.success on reject success', async () => {
      const { component, api, toast } = makeComponent();
      api.get.mockReturnValue(of([FLAGGED_ITEM]));
      await component.ngOnInit();
      component.openAction(FLAGGED_ITEM, 'reject');
      component.actionNote = 'violates terms';
      api.post.mockReturnValue(of({ ...FLAGGED_ITEM }));

      await component.confirmAction();

      expect(toast.success).toHaveBeenCalled();
    });

    it('sets acting false after reject (success or failure)', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of([FLAGGED_ITEM]));
      await component.ngOnInit();
      component.openAction(FLAGGED_ITEM, 'reject');
      component.actionNote = 'bad content';
      api.post.mockReturnValue(of({ ...FLAGGED_ITEM }));

      await component.confirmAction();

      expect(component.acting()).toBe(false);
    });
  });
});
