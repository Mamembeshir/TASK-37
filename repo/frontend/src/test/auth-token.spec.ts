/**
 * Example frontend unit tests — token storage utilities.
 *
 * These run in a jsdom environment (no Angular DI needed) and demonstrate
 * how to test pure service logic in isolation. For full Angular component
 * tests (template rendering, change detection), add @analogjs/vitest-angular.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Token helpers (inline — mirrors what AuthService does internally) ───────

const TOKEN_KEY = 'auth_token';

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function isExpiredJwt(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return typeof payload['exp'] === 'number' && payload['exp'] * 1000 < Date.now();
  } catch {
    return true;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and retrieves a token', () => {
    saveToken('abc123');
    expect(loadToken()).toBe('abc123');
  });

  it('returns null when no token stored', () => {
    expect(loadToken()).toBeNull();
  });

  it('clears the token', () => {
    saveToken('abc123');
    clearToken();
    expect(loadToken()).toBeNull();
  });
});

describe('isExpiredJwt', () => {
  function makeToken(exp: number): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: 'user1', exp }));
    return `${header}.${payload}.fakesig`;
  }

  it('returns true for an expired token (past exp)', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    expect(isExpiredJwt(makeToken(pastExp))).toBe(true);
  });

  it('returns false for a valid token (future exp)', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour ahead
    expect(isExpiredJwt(makeToken(futureExp))).toBe(false);
  });

  it('returns true for a malformed token', () => {
    expect(isExpiredJwt('not.a.token')).toBe(true);
  });
});
