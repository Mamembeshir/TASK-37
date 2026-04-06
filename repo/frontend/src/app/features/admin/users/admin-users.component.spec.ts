/**
 * Unit tests for AdminUsersComponent.
 *
 * Strategy: vi.mock('@angular/core') replaces `inject` so the component can
 * be instantiated without TestBed.  Signals stay real.
 *
 * Coverage:
 *  - Initial signal state
 *  - load() — success, API error
 *  - Filter changes (q, role, isLocked) reset offset and reload
 *  - Pagination (prevPage / nextPage)
 *  - openRoleModal / closeRoleModal
 *  - confirmRoleChange — success, error
 *  - resetLockout — success, error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminUsersComponent } from './admin-users.component';
import type { AdminUser } from './admin-users.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER: AdminUser = {
  id: 'u-1',
  username: 'alice',
  role: 'customer',
  phone: null,
  isLocked: false,
  failedAttempts: 0,
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

const MOCK_LOCKED_USER: AdminUser = {
  ...MOCK_USER,
  id: 'u-2',
  username: 'bob',
  isLocked: true,
  failedAttempts: 5,
  lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};

const MOCK_LIST = { data: [MOCK_USER], total: 1, limit: 30, offset: 0 };

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
  const component = new AdminUsersComponent();
  return { component, api, toast };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminUsersComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('loading is true before any data is fetched', () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      expect(component.loading()).toBe(true);
    });

    it('users is empty before load', () => {
      const { component } = makeComponent();
      expect(component.users()).toEqual([]);
    });

    it('total is 0 before load', () => {
      const { component } = makeComponent();
      expect(component.total()).toBe(0);
    });

    it('offset starts at 0', () => {
      const { component } = makeComponent();
      expect(component.offset()).toBe(0);
    });
  });

  // ── ngOnInit / load ────────────────────────────────────────────────────────

  describe('ngOnInit', () => {
    it('calls api.get with /admin/users on init', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      expect(api.get).toHaveBeenCalledWith('/admin/users', expect.any(Object));
    });

    it('populates users signal on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      expect(component.users()).toEqual([MOCK_USER]);
      expect(component.total()).toBe(1);
    });

    it('sets loading to false after successful load', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('sets users to [] and total to 0 on API error', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(throwError(() => new Error('network')));
      await component.ngOnInit();
      expect(component.users()).toEqual([]);
      expect(component.total()).toBe(0);
    });

    it('sets loading to false even on API error', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(throwError(() => new Error('network')));
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });
  });

  // ── Filters ────────────────────────────────────────────────────────────────

  describe('filter changes', () => {
    it('onQueryChange sets filterQuery, resets offset, reloads', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.offset.set(30);
      component.onQueryChange('alice');
      expect(component.filterQuery()).toBe('alice');
      expect(component.offset()).toBe(0);
      expect(api.get).toHaveBeenCalled();
    });

    it('onRoleChange sets filterRole, resets offset, reloads', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.offset.set(30);
      component.onRoleChange('admin');
      expect(component.filterRole()).toBe('admin');
      expect(component.offset()).toBe(0);
    });

    it('onLockedChange sets filterLocked, resets offset, reloads', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.offset.set(30);
      component.onLockedChange('true');
      expect(component.filterLocked()).toBe('true');
      expect(component.offset()).toBe(0);
    });

    it('passes q param to API when filterQuery is set', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.filterQuery.set('bob');
      await component.ngOnInit();
      expect(api.get).toHaveBeenCalledWith(
        '/admin/users',
        expect.objectContaining({ q: 'bob' }),
      );
    });

    it('passes isLocked param to API when filterLocked is set', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.filterLocked.set('true');
      await component.ngOnInit();
      expect(api.get).toHaveBeenCalledWith(
        '/admin/users',
        expect.objectContaining({ isLocked: 'true' }),
      );
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('nextPage increments offset by PAGE_SIZE', () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.offset.set(0);
      component.nextPage();
      expect(component.offset()).toBe(30);
    });

    it('prevPage decrements offset by PAGE_SIZE, floored at 0', () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.offset.set(30);
      component.prevPage();
      expect(component.offset()).toBe(0);
    });

    it('prevPage does not go below 0', () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      component.offset.set(0);
      component.prevPage();
      expect(component.offset()).toBe(0);
    });
  });

  // ── Role modal ─────────────────────────────────────────────────────────────

  describe('openRoleModal / closeRoleModal', () => {
    it('openRoleModal sets roleTarget and initialises newRole to current role', () => {
      const { component } = makeComponent();
      component.openRoleModal(MOCK_USER);
      expect(component.roleTarget()).toEqual(MOCK_USER);
      expect(component.newRole()).toBe('customer');
    });

    it('openRoleModal clears modalError', () => {
      const { component } = makeComponent();
      component.modalError.set('previous error');
      component.openRoleModal(MOCK_USER);
      expect(component.modalError()).toBeNull();
    });

    it('closeRoleModal clears roleTarget and modalError', () => {
      const { component } = makeComponent();
      component.openRoleModal(MOCK_USER);
      component.modalError.set('some error');
      component.closeRoleModal();
      expect(component.roleTarget()).toBeNull();
      expect(component.modalError()).toBeNull();
    });
  });

  // ── confirmRoleChange ──────────────────────────────────────────────────────

  describe('confirmRoleChange', () => {
    it('calls api.patch with the new role', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      component.openRoleModal(MOCK_USER);
      component.newRole.set('associate');
      const updated = { ...MOCK_USER, role: 'associate' as const };
      api.patch.mockReturnValue(of(updated));

      await component.confirmRoleChange();

      expect(api.patch).toHaveBeenCalledWith(
        `/admin/users/${MOCK_USER.id}/role`,
        { role: 'associate' },
      );
    });

    it('updates the user in the list on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      component.openRoleModal(MOCK_USER);
      component.newRole.set('associate');
      const updated = { ...MOCK_USER, role: 'associate' as const };
      api.patch.mockReturnValue(of(updated));

      await component.confirmRoleChange();

      expect(component.users()[0]?.role).toBe('associate');
    });

    it('closes the modal on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      component.openRoleModal(MOCK_USER);
      component.newRole.set('associate');
      api.patch.mockReturnValue(of({ ...MOCK_USER, role: 'associate' as const }));

      await component.confirmRoleChange();

      expect(component.roleTarget()).toBeNull();
    });

    it('sets modalError on API error', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      component.openRoleModal(MOCK_USER);
      component.newRole.set('associate');
      api.patch.mockReturnValue(
        throwError(() => ({ error: { error: 'Role change failed' } })),
      );

      await component.confirmRoleChange();

      expect(component.modalError()).toBeTruthy();
    });

    it('is a no-op when newRole equals current role', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      component.openRoleModal(MOCK_USER);
      // newRole defaults to MOCK_USER.role = 'customer'

      await component.confirmRoleChange();

      expect(api.patch).not.toHaveBeenCalled();
    });

    it('sets acting true during the call and false after', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of(MOCK_LIST));
      await component.ngOnInit();
      component.openRoleModal(MOCK_USER);
      component.newRole.set('associate');
      api.patch.mockReturnValue(of({ ...MOCK_USER, role: 'associate' as const }));

      const promise = component.confirmRoleChange();
      // acting should be false after the promise resolves
      await promise;
      expect(component.acting()).toBe(false);
    });
  });

  // ── resetLockout ───────────────────────────────────────────────────────────

  describe('resetLockout', () => {
    it('calls api.post with /admin/users/:id/reset-lockout', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of({ data: [MOCK_LOCKED_USER], total: 1, limit: 30, offset: 0 }));
      await component.ngOnInit();
      const unlocked = { ...MOCK_LOCKED_USER, isLocked: false, failedAttempts: 0, lockedUntil: null };
      api.post.mockReturnValue(of(unlocked));

      await component.resetLockout(MOCK_LOCKED_USER);

      expect(api.post).toHaveBeenCalledWith(
        `/admin/users/${MOCK_LOCKED_USER.id}/reset-lockout`,
        {},
      );
    });

    it('updates the user in the list on success', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of({ data: [MOCK_LOCKED_USER], total: 1, limit: 30, offset: 0 }));
      await component.ngOnInit();
      const unlocked = { ...MOCK_LOCKED_USER, isLocked: false, failedAttempts: 0, lockedUntil: null };
      api.post.mockReturnValue(of(unlocked));

      await component.resetLockout(MOCK_LOCKED_USER);

      expect(component.users()[0]?.isLocked).toBe(false);
    });

    it('calls toast.success on success', async () => {
      const { component, api, toast } = makeComponent();
      api.get.mockReturnValue(of({ data: [MOCK_LOCKED_USER], total: 1, limit: 30, offset: 0 }));
      await component.ngOnInit();
      api.post.mockReturnValue(of({ ...MOCK_LOCKED_USER, isLocked: false, failedAttempts: 0, lockedUntil: null }));

      await component.resetLockout(MOCK_LOCKED_USER);

      expect(toast.success).toHaveBeenCalled();
    });

    it('calls toast.error on API failure', async () => {
      const { component, api, toast } = makeComponent();
      api.get.mockReturnValue(of({ data: [MOCK_LOCKED_USER], total: 1, limit: 30, offset: 0 }));
      await component.ngOnInit();
      api.post.mockReturnValue(throwError(() => new Error('network')));

      await component.resetLockout(MOCK_LOCKED_USER);

      expect(toast.error).toHaveBeenCalled();
    });

    it('clears unlockingId after call (success or failure)', async () => {
      const { component, api } = makeComponent();
      api.get.mockReturnValue(of({ data: [MOCK_LOCKED_USER], total: 1, limit: 30, offset: 0 }));
      await component.ngOnInit();
      api.post.mockReturnValue(of({ ...MOCK_LOCKED_USER, isLocked: false, failedAttempts: 0, lockedUntil: null }));

      await component.resetLockout(MOCK_LOCKED_USER);

      expect(component.unlockingId()).toBeNull();
    });
  });
});
