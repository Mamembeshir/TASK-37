/**
 * Unit tests for AuthService.
 *
 * Strategy: vi.mock('@angular/core') replaces `inject` with a spy so that
 * `new AuthService()` resolves its dependencies from our mocks rather than
 * Angular's DI system.  `signal` / `computed` stay real — they work fine in
 * jsdom without TestBed.
 *
 * Coverage:
 *  - Initial reactive state (currentUser, isLoggedIn, role, isStaff, token)
 *  - login() — success, 401, 423, token/signal side-effects
 *  - logout() — clears state, navigates, server-failure resilience
 *  - loadCurrentUser() — no-op without token, success, error recovery
 *  - hasRole() — single role, multi-role, not-logged-in
 *  - Computed signals — reactive updates through login/logout cycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import type { LoginResponse, User } from '../models/user.model';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER: User = { id: 'u-1', username: 'alice', role: 'customer' };

const MOCK_TOKEN = 'tok.abc.xyz';

const MOCK_LOGIN_RESP: LoginResponse = {
  token: MOCK_TOKEN,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: MOCK_USER,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApiSpy() {
  return { post: vi.fn(), get: vi.fn() };
}

function makeRouterSpy() {
  return {
    navigate: vi.fn().mockResolvedValue(true),
    navigateByUrl: vi.fn().mockResolvedValue(true),
  };
}

/** Wire inject() mock and return a fresh AuthService instance. */
function makeService(
  api = makeApiSpy(),
  router = makeRouterSpy(),
): { service: AuthService; api: ReturnType<typeof makeApiSpy>; router: ReturnType<typeof makeRouterSpy> } {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === ApiService) return api;
    if (token === Router) return router;
    return undefined;
  });
  const service = new AuthService();
  return { service, api, router };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('currentUser() is null before login', () => {
      const { service } = makeService();
      expect(service.currentUser()).toBeNull();
    });

    it('isLoggedIn() is false before login', () => {
      const { service } = makeService();
      expect(service.isLoggedIn()).toBe(false);
    });

    it('role() is null before login', () => {
      const { service } = makeService();
      expect(service.role()).toBeNull();
    });

    it('isStaff() is false before login', () => {
      const { service } = makeService();
      expect(service.isStaff()).toBe(false);
    });

    it('token is null when localStorage is empty', () => {
      const { service } = makeService();
      expect(service.token).toBeNull();
    });
  });

  // ── login() ───────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('calls api.post /auth/login with the supplied credentials', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        username: 'alice',
        password: 'password1234',
      });
    });

    it('stores the token in localStorage on success', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(localStorage.getItem('roh_token')).toBe(MOCK_TOKEN);
    });

    it('sets currentUser signal to the returned user', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(service.currentUser()).toEqual(MOCK_USER);
    });

    it('isLoggedIn() becomes true after a successful login', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(service.isLoggedIn()).toBe(true);
    });

    it('returns the user object on success', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      const user = await service.login('alice', 'password1234');
      expect(user).toEqual(MOCK_USER);
    });

    it('throws on 401 and leaves currentUser null', async () => {
      const { service, api } = makeService();
      const err401 = { status: 401 };
      api.post.mockReturnValue(throwError(() => err401));
      await expect(service.login('alice', 'wrong')).rejects.toEqual(err401);
      expect(service.currentUser()).toBeNull();
    });

    it('does not save a token when login fails', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(throwError(() => ({ status: 401 })));
      await expect(service.login('alice', 'wrong')).rejects.toBeDefined();
      expect(localStorage.getItem('roh_token')).toBeNull();
    });

    it('throws on 423 (account locked) without modifying state', async () => {
      const { service, api } = makeService();
      const err423 = { status: 423 };
      api.post.mockReturnValue(throwError(() => err423));
      await expect(service.login('alice', 'pass')).rejects.toEqual(err423);
      expect(service.isLoggedIn()).toBe(false);
    });
  });

  // ── logout() ──────────────────────────────────────────────────────────────

  describe('logout()', () => {
    async function loginFirst(service: AuthService, api: ReturnType<typeof makeApiSpy>) {
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
    }

    it('clears the token from localStorage', async () => {
      const { service, api } = makeService();
      await loginFirst(service, api);
      api.post.mockReturnValue(of({ ok: true }));
      await service.logout();
      expect(localStorage.getItem('roh_token')).toBeNull();
    });

    it('sets currentUser to null', async () => {
      const { service, api } = makeService();
      await loginFirst(service, api);
      api.post.mockReturnValue(of({ ok: true }));
      await service.logout();
      expect(service.currentUser()).toBeNull();
    });

    it('navigates to /login', async () => {
      const { service, api, router } = makeService();
      await loginFirst(service, api);
      api.post.mockReturnValue(of({ ok: true }));
      await service.logout();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('still clears state and navigates even when the server call fails', async () => {
      const { service, api, router } = makeService();
      await loginFirst(service, api);
      api.post.mockReturnValue(throwError(() => ({ status: 500 })));
      await service.logout();
      expect(service.currentUser()).toBeNull();
      expect(localStorage.getItem('roh_token')).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('skips the API call and still navigates when no token is stored', async () => {
      const { service, api, router } = makeService();
      // Never logged in — no token
      await service.logout();
      expect(api.post).not.toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  // ── loadCurrentUser() ─────────────────────────────────────────────────────

  describe('loadCurrentUser()', () => {
    it('does nothing when no token is stored', async () => {
      const { service, api } = makeService();
      await service.loadCurrentUser();
      expect(api.get).not.toHaveBeenCalled();
      expect(service.currentUser()).toBeNull();
    });

    it('calls GET /auth/me with the stored token', async () => {
      const { service, api } = makeService();
      localStorage.setItem('roh_token', MOCK_TOKEN);
      api.get.mockReturnValue(of(MOCK_USER));
      await service.loadCurrentUser();
      expect(api.get).toHaveBeenCalledWith('/auth/me');
    });

    it('sets currentUser from the /auth/me response', async () => {
      const { service, api } = makeService();
      localStorage.setItem('roh_token', MOCK_TOKEN);
      api.get.mockReturnValue(of(MOCK_USER));
      await service.loadCurrentUser();
      expect(service.currentUser()).toEqual(MOCK_USER);
    });

    it('clears token and currentUser when /auth/me returns an error', async () => {
      const { service, api } = makeService();
      localStorage.setItem('roh_token', MOCK_TOKEN);
      api.get.mockReturnValue(throwError(() => ({ status: 401 })));
      await service.loadCurrentUser();
      expect(service.currentUser()).toBeNull();
      expect(localStorage.getItem('roh_token')).toBeNull();
    });
  });

  // ── hasRole() ─────────────────────────────────────────────────────────────

  describe('hasRole()', () => {
    it('returns false when not logged in', () => {
      const { service } = makeService();
      expect(service.hasRole('customer')).toBe(false);
    });

    it('returns true when the user has the exact requested role', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP)); // user.role = 'customer'
      await service.login('alice', 'password1234');
      expect(service.hasRole('customer')).toBe(true);
    });

    it('returns false when the user does not have the requested role', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(service.hasRole('admin')).toBe(false);
    });

    it('returns true when the user role appears in a multi-role list', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(service.hasRole('associate', 'customer', 'admin')).toBe(true);
    });
  });

  // ── Computed signals ───────────────────────────────────────────────────────

  describe('computed signals', () => {
    it('role() reflects the current user role after login', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP)); // role: 'customer'
      await service.login('alice', 'password1234');
      expect(service.role()).toBe('customer');
    });

    it('isStaff() is false for customer role', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of({ ...MOCK_LOGIN_RESP, user: { ...MOCK_USER, role: 'customer' } }));
      await service.login('alice', 'password1234');
      expect(service.isStaff()).toBe(false);
    });

    it('isStaff() is true for associate role', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of({ ...MOCK_LOGIN_RESP, user: { ...MOCK_USER, role: 'associate' } }));
      await service.login('alice', 'password1234');
      expect(service.isStaff()).toBe(true);
    });

    it('isStaff() is true for admin role', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of({ ...MOCK_LOGIN_RESP, user: { ...MOCK_USER, role: 'admin' } }));
      await service.login('alice', 'password1234');
      expect(service.isStaff()).toBe(true);
    });

    it('all signals reset to falsy values after logout', async () => {
      const { service, api } = makeService();
      api.post.mockReturnValue(of(MOCK_LOGIN_RESP));
      await service.login('alice', 'password1234');
      expect(service.isLoggedIn()).toBe(true);

      api.post.mockReturnValue(of({ ok: true }));
      await service.logout();

      expect(service.isLoggedIn()).toBe(false);
      expect(service.role()).toBeNull();
      expect(service.isStaff()).toBe(false);
      expect(service.currentUser()).toBeNull();
    });
  });
});
