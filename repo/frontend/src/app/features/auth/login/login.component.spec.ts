/**
 * Unit tests for LoginComponent.
 *
 * Strategy: vi.mock('@angular/core') replaces `inject` with a spy so the
 * component can be instantiated without Angular's DI or TestBed.  Signals
 * (`signal`, `computed`) keep their real implementations and are read directly
 * — no template rendering or change detection needed.
 *
 * Coverage:
 *  - Initial signal state (loading, lockoutMessage)
 *  - submit() success — calls auth.login, navigates to returnUrl or /
 *  - submit() 401 — calls toast.error with invalid-credentials message
 *  - submit() 423 — sets lockoutMessage, toast.error not called
 *  - submit() network error — calls toast.error with connection message
 *  - submit() loading guard — ignores calls while already loading
 *  - State cleanup — lockoutMessage cleared before each new attempt
 *  - loading signal — true during, false after (success and failure)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import type { User } from '../../../core/models/user.model';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER: User = { id: 'u-1', username: 'alice', role: 'customer' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuthSpy() {
  return { login: vi.fn() };
}

function makeRouterSpy() {
  return { navigateByUrl: vi.fn().mockResolvedValue(true) };
}

/** Build a mock ActivatedRoute with an optional returnUrl query param. */
function makeRouteSpy(returnUrl: string | null = null) {
  return {
    snapshot: {
      queryParamMap: { get: vi.fn().mockReturnValue(returnUrl) },
    },
  };
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
}

/** Wire inject() mock and return a fresh LoginComponent instance. */
function makeComponent(
  auth   = makeAuthSpy(),
  router = makeRouterSpy(),
  route  = makeRouteSpy(),
  toast  = makeToast(),
): {
  component: LoginComponent;
  auth:   ReturnType<typeof makeAuthSpy>;
  router: ReturnType<typeof makeRouterSpy>;
  route:  ReturnType<typeof makeRouteSpy>;
  toast:  ReturnType<typeof makeToast>;
} {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === AuthService)    return auth;
    if (token === Router)         return router;
    if (token === ActivatedRoute) return route;
    if (token === ToastService)   return toast;
    return undefined;
  });
  const component = new LoginComponent();
  return { component, auth, router, route, toast };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LoginComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('loading is false', () => {
      const { component } = makeComponent();
      expect(component.loading()).toBe(false);
    });

    it('lockoutMessage is null', () => {
      const { component } = makeComponent();
      expect(component.lockoutMessage()).toBeNull();
    });

    it('username is an empty string', () => {
      const { component } = makeComponent();
      expect(component.username).toBe('');
    });

    it('password is an empty string', () => {
      const { component } = makeComponent();
      expect(component.password).toBe('');
    });
  });

  // ── submit() — successful login ────────────────────────────────────────────

  describe('submit() — successful login', () => {
    it('calls auth.login with the current username and password', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockResolvedValue(MOCK_USER);
      component.username = 'alice';
      component.password = 'password1234';
      await component.submit();
      expect(auth.login).toHaveBeenCalledWith('alice', 'password1234');
    });

    it('navigates to / when no returnUrl query param is present', async () => {
      const { component, auth, router } = makeComponent(
        makeAuthSpy(),
        makeRouterSpy(),
        makeRouteSpy(null),
      );
      auth.login.mockResolvedValue(MOCK_USER);
      await component.submit();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('navigates to the returnUrl query param on success', async () => {
      const { component, auth, router } = makeComponent(
        makeAuthSpy(),
        makeRouterSpy(),
        makeRouteSpy('/orders'),
      );
      auth.login.mockResolvedValue(MOCK_USER);
      await component.submit();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/orders');
    });

    it('loading is false after successful login', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockResolvedValue(MOCK_USER);
      await component.submit();
      expect(component.loading()).toBe(false);
    });

    it('toast.error is not called after successful login', async () => {
      const { component, auth, toast } = makeComponent();
      auth.login.mockResolvedValue(MOCK_USER);
      await component.submit();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('lockoutMessage remains null after successful login', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockResolvedValue(MOCK_USER);
      await component.submit();
      expect(component.lockoutMessage()).toBeNull();
    });
  });

  // ── submit() — 401 invalid credentials ────────────────────────────────────

  describe('submit() — 401 invalid credentials', () => {
    it('calls toast.error with the invalid-credentials message', async () => {
      const { component, auth, toast } = makeComponent();
      auth.login.mockRejectedValue({ status: 401 });
      await component.submit();
      expect(toast.error).toHaveBeenCalledWith('Invalid username or password.');
    });

    it('leaves lockoutMessage null on a 401', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValue({ status: 401 });
      await component.submit();
      expect(component.lockoutMessage()).toBeNull();
    });

    it('loading is false after a 401', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValue({ status: 401 });
      await component.submit();
      expect(component.loading()).toBe(false);
    });

    it('does not navigate on a 401', async () => {
      const { component, auth, router } = makeComponent();
      auth.login.mockRejectedValue({ status: 401 });
      await component.submit();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  // ── submit() — 423 account locked ─────────────────────────────────────────

  describe('submit() — 423 account locked', () => {
    it('sets lockoutMessage mentioning 15 minutes', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValue({ status: 423 });
      await component.submit();
      expect(component.lockoutMessage()).toContain('15 minutes');
    });

    it('lockoutMessage references too many failed attempts', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValue({ status: 423 });
      await component.submit();
      expect(component.lockoutMessage()).toMatch(/too many failed attempts/i);
    });

    it('toast.error is not called on a 423 (lockout shown inline)', async () => {
      const { component, auth, toast } = makeComponent();
      auth.login.mockRejectedValue({ status: 423 });
      await component.submit();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('loading is false after a 423', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValue({ status: 423 });
      await component.submit();
      expect(component.loading()).toBe(false);
    });
  });

  // ── submit() — network / unknown error ────────────────────────────────────

  describe('submit() — network or unknown error', () => {
    it('calls toast.error with "Unable to connect" message for status 0', async () => {
      const { component, auth, toast } = makeComponent();
      auth.login.mockRejectedValue({ status: 0 });
      await component.submit();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Unable to connect'),
      );
    });

    it('calls toast.error with "Unable to connect" message for a 500 server error', async () => {
      const { component, auth, toast } = makeComponent();
      auth.login.mockRejectedValue({ status: 500 });
      await component.submit();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Unable to connect'),
      );
    });

    it('does not set lockoutMessage for non-423 errors', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValue({ status: 500 });
      await component.submit();
      expect(component.lockoutMessage()).toBeNull();
    });
  });

  // ── submit() — loading guard ───────────────────────────────────────────────

  describe('submit() — loading guard', () => {
    it('does not call auth.login when loading is already true', async () => {
      const { component, auth } = makeComponent();
      component.loading.set(true); // simulate in-flight request
      await component.submit();
      expect(auth.login).not.toHaveBeenCalled();
    });
  });

  // ── State cleanup between attempts ────────────────────────────────────────

  describe('state cleanup between attempts', () => {
    it('clears lockoutMessage when a subsequent attempt succeeds', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValueOnce({ status: 423 });
      await component.submit();
      expect(component.lockoutMessage()).not.toBeNull();

      auth.login.mockResolvedValue(MOCK_USER);
      await component.submit();
      expect(component.lockoutMessage()).toBeNull();
    });

    it('clears lockoutMessage before the next attempt even if it also fails', async () => {
      const { component, auth } = makeComponent();
      auth.login.mockRejectedValueOnce({ status: 423 });
      await component.submit(); // sets lockoutMessage

      auth.login.mockRejectedValueOnce({ status: 401 });
      await component.submit(); // clears lockoutMessage then shows toast
      expect(component.lockoutMessage()).toBeNull();
    });

    it('calls toast.error on a 401 that follows a 423', async () => {
      const { component, auth, toast } = makeComponent();
      auth.login.mockRejectedValueOnce({ status: 423 });
      await component.submit();

      auth.login.mockRejectedValueOnce({ status: 401 });
      await component.submit();
      expect(toast.error).toHaveBeenCalledWith('Invalid username or password.');
    });
  });
});
