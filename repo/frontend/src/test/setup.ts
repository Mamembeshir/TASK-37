/**
 * Global test setup for the frontend test suite.
 *
 * jsdom provides browser globals (window, document, localStorage, etc.).
 * Importing @angular/compiler enables JIT compilation fallback so that
 * Angular packages (router, common, etc.) can be imported in tests without
 * a full Angular platform bootstrap.
 *
 * Angular component *template* rendering still requires @analogjs/vitest-angular.
 * These tests bypass template compilation by mocking `inject` from @angular/core,
 * which lets service/component logic be tested as plain class instances.
 */

// Enable JIT compiler for Angular packages that use partial compilation.
import '@angular/compiler';

// Make localStorage available to services that read auth tokens.
if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => { store[key] = val; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
      };
    })(),
  });
}
