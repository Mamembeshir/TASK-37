/**
 * Unit tests for CatalogComponent.
 *
 * Strategy:
 *  - vi.mock('@angular/core') replaces inject() with a spy (so ProductService
 *    resolves from our mock) and replaces effect() with a spy that captures the
 *    reactive callback — letting tests trigger loadProducts() manually without
 *    an Angular injection context or zone.js.
 *  - vi.useFakeTimers() controls the 350 ms search debounce.
 *  - await flushPromises() drains microtasks after async loadProducts calls.
 *
 * Coverage:
 *  - All signal initial values
 *  - hasFilters() computed: every contributing signal
 *  - Filter handlers: brand, minPrice, maxPrice, available, sortBy (offset reset)
 *  - Search debounce: searchRaw vs searchQuery timing, rapid-input reset
 *  - clearFilters(): all signals reset, pending debounce cancelled
 *  - Pagination: nextPage / prevPage / currentPage / pageCount
 *  - loadProducts (via effect): loading states, products + total updated,
 *    error path, correct params passed to ProductService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inject, effect } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { CatalogComponent } from './catalog.component';
import type { Product, ProductListResponse } from '../../core/models/product.model';

// ── Captured effect callbacks (must be hoisted before vi.mock) ────────────────

const { effectCallbacks } = vi.hoisted(() => ({
  effectCallbacks: [] as Array<() => void>,
}));

// ── Mock @angular/core ────────────────────────────────────────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return {
    ...actual,
    inject: vi.fn(),
    // Capture the effect callback so tests can trigger loadProducts manually
    effect: vi.fn((fn: () => void) => {
      effectCallbacks.push(fn);
    }),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PRODUCT: Product = {
  id: 'prod-1',
  name: 'Widget Pro',
  description: 'A great widget',
  brand: 'WidgetCo',
  price: '29.99',
  stockQty: 10,
  category: 'gadgets',
  isActive: true,
  createdAt: '2025-01-01T00:00:00Z',
};

function mockResponse(products: Product[] = [MOCK_PRODUCT], total = 1): ProductListResponse {
  return { data: products, total, limit: 20, offset: 0 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProductSvc() {
  return { search: vi.fn() };
}

function makeComponent(productSvc = makeProductSvc()) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === ProductService) return productSvc;
    return undefined;
  });
  const component = new CatalogComponent();
  return { component, productSvc };
}

/** Return the most recently captured effect callback. */
function lastEffect(): () => void {
  return effectCallbacks[effectCallbacks.length - 1]!;
}

/** Trigger the reactive effect (simulating what Angular would do). */
function triggerEffect(): void {
  lastEffect()();
}

/** Drain async microtasks after a loadProducts call. */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CatalogComponent', () => {
  beforeEach(() => {
    effectCallbacks.length = 0;
    vi.clearAllMocks();
  });

  // ── Initial signal state ───────────────────────────────────────────────────

  describe('initial signal state', () => {
    it('searchRaw is empty', () => {
      const { component } = makeComponent();
      expect(component.searchRaw()).toBe('');
    });

    it('searchQuery is empty', () => {
      const { component } = makeComponent();
      expect(component.searchQuery()).toBe('');
    });

    it('brand is empty', () => {
      const { component } = makeComponent();
      expect(component.brand()).toBe('');
    });

    it('minPriceRaw is empty', () => {
      const { component } = makeComponent();
      expect(component.minPriceRaw()).toBe('');
    });

    it('maxPriceRaw is empty', () => {
      const { component } = makeComponent();
      expect(component.maxPriceRaw()).toBe('');
    });

    it('available is false', () => {
      const { component } = makeComponent();
      expect(component.available()).toBe(false);
    });

    it('sortBy defaults to name_asc', () => {
      const { component } = makeComponent();
      expect(component.sortBy()).toBe('name_asc');
    });

    it('offset is 0', () => {
      const { component } = makeComponent();
      expect(component.offset()).toBe(0);
    });

    it('loading starts true', () => {
      const { component } = makeComponent();
      expect(component.loading()).toBe(true);
    });

    it('products starts empty', () => {
      const { component } = makeComponent();
      expect(component.products()).toHaveLength(0);
    });

    it('total starts 0', () => {
      const { component } = makeComponent();
      expect(component.total()).toBe(0);
    });
  });

  // ── hasFilters() computed ─────────────────────────────────────────────────

  describe('hasFilters()', () => {
    it('is false initially', () => {
      const { component } = makeComponent();
      expect(component.hasFilters()).toBe(false);
    });

    it('is true when searchQuery is set', () => {
      const { component } = makeComponent();
      component.searchQuery.set('shoes');
      expect(component.hasFilters()).toBe(true);
    });

    it('is true when brand is set', () => {
      const { component } = makeComponent();
      component.brand.set('Nike');
      expect(component.hasFilters()).toBe(true);
    });

    it('is true when minPriceRaw is set', () => {
      const { component } = makeComponent();
      component.minPriceRaw.set('10');
      expect(component.hasFilters()).toBe(true);
    });

    it('is true when maxPriceRaw is set', () => {
      const { component } = makeComponent();
      component.maxPriceRaw.set('100');
      expect(component.hasFilters()).toBe(true);
    });

    it('is true when available is true', () => {
      const { component } = makeComponent();
      component.available.set(true);
      expect(component.hasFilters()).toBe(true);
    });

    it('returns false when all filters are cleared', () => {
      const { component } = makeComponent();
      component.brand.set('Nike');
      component.available.set(true);
      expect(component.hasFilters()).toBe(true);

      component.clearFilters();
      expect(component.hasFilters()).toBe(false);
    });
  });

  // ── Filter event handlers ─────────────────────────────────────────────────

  describe('filter event handlers', () => {
    it('onBrandChange sets brand and resets offset', () => {
      const { component } = makeComponent();
      component.offset.set(20);
      component.onBrandChange('Nike');
      expect(component.brand()).toBe('Nike');
      expect(component.offset()).toBe(0);
    });

    it('onBrandChange trims whitespace', () => {
      const { component } = makeComponent();
      component.onBrandChange('  Adidas  ');
      expect(component.brand()).toBe('Adidas');
    });

    it('onMinPriceChange sets minPriceRaw and resets offset', () => {
      const { component } = makeComponent();
      component.offset.set(40);
      component.onMinPriceChange('25');
      expect(component.minPriceRaw()).toBe('25');
      expect(component.offset()).toBe(0);
    });

    it('onMaxPriceChange sets maxPriceRaw and resets offset', () => {
      const { component } = makeComponent();
      component.offset.set(40);
      component.onMaxPriceChange('200');
      expect(component.maxPriceRaw()).toBe('200');
      expect(component.offset()).toBe(0);
    });

    it('onAvailableChange sets available and resets offset', () => {
      const { component } = makeComponent();
      component.offset.set(20);
      component.onAvailableChange(true);
      expect(component.available()).toBe(true);
      expect(component.offset()).toBe(0);
    });

    it('onSortChange sets sortBy and resets offset', () => {
      const { component } = makeComponent();
      component.offset.set(20);
      component.onSortChange('price_asc');
      expect(component.sortBy()).toBe('price_asc');
      expect(component.offset()).toBe(0);
    });
  });

  // ── Search debounce ───────────────────────────────────────────────────────

  describe('search debounce (350 ms)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('immediately updates searchRaw on input', () => {
      const { component } = makeComponent();
      component.onSearchInput('hello');
      expect(component.searchRaw()).toBe('hello');
    });

    it('does NOT update searchQuery before the debounce fires', () => {
      const { component } = makeComponent();
      component.onSearchInput('hello');
      vi.advanceTimersByTime(349);
      expect(component.searchQuery()).toBe('');
    });

    it('updates searchQuery after 350 ms', () => {
      const { component } = makeComponent();
      component.onSearchInput('hello');
      vi.advanceTimersByTime(350);
      expect(component.searchQuery()).toBe('hello');
    });

    it('trims whitespace from searchQuery when debounce fires', () => {
      const { component } = makeComponent();
      component.onSearchInput('  hello  ');
      vi.advanceTimersByTime(350);
      expect(component.searchQuery()).toBe('hello');
    });

    it('resets debounce timer on rapid successive inputs', () => {
      const { component } = makeComponent();
      component.onSearchInput('h');
      vi.advanceTimersByTime(200);
      component.onSearchInput('he');
      vi.advanceTimersByTime(200);
      // only 200ms since last input — should not have fired
      expect(component.searchQuery()).toBe('');
      vi.advanceTimersByTime(150); // now 350ms from last input
      expect(component.searchQuery()).toBe('he');
    });

    it('resets offset to 0 when the debounce fires', () => {
      const { component } = makeComponent();
      component.offset.set(40);
      component.onSearchInput('shoes');
      vi.advanceTimersByTime(350);
      expect(component.offset()).toBe(0);
    });
  });

  // ── clearFilters() ────────────────────────────────────────────────────────

  describe('clearFilters()', () => {
    it('resets searchRaw to empty', () => {
      const { component } = makeComponent();
      component.searchRaw.set('shoes');
      component.clearFilters();
      expect(component.searchRaw()).toBe('');
    });

    it('resets searchQuery to empty', () => {
      const { component } = makeComponent();
      component.searchQuery.set('shoes');
      component.clearFilters();
      expect(component.searchQuery()).toBe('');
    });

    it('resets brand to empty', () => {
      const { component } = makeComponent();
      component.brand.set('Nike');
      component.clearFilters();
      expect(component.brand()).toBe('');
    });

    it('resets minPriceRaw to empty', () => {
      const { component } = makeComponent();
      component.minPriceRaw.set('10');
      component.clearFilters();
      expect(component.minPriceRaw()).toBe('');
    });

    it('resets maxPriceRaw to empty', () => {
      const { component } = makeComponent();
      component.maxPriceRaw.set('100');
      component.clearFilters();
      expect(component.maxPriceRaw()).toBe('');
    });

    it('resets available to false', () => {
      const { component } = makeComponent();
      component.available.set(true);
      component.clearFilters();
      expect(component.available()).toBe(false);
    });

    it('resets offset to 0', () => {
      const { component } = makeComponent();
      component.offset.set(40);
      component.clearFilters();
      expect(component.offset()).toBe(0);
    });

    it('cancels a pending debounce so searchQuery is not set late', () => {
      vi.useFakeTimers();
      const { component } = makeComponent();
      component.onSearchInput('shoes');
      // Before the 350ms fires, clear filters
      component.clearFilters();
      vi.advanceTimersByTime(500);
      // searchQuery should still be empty (debounce was cancelled)
      expect(component.searchQuery()).toBe('');
      vi.useRealTimers();
    });
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('nextPage increments offset by PAGE_SIZE (20)', () => {
      const { component } = makeComponent();
      expect(component.offset()).toBe(0);
      component.nextPage();
      expect(component.offset()).toBe(20);
    });

    it('nextPage can be called multiple times', () => {
      const { component } = makeComponent();
      component.nextPage();
      component.nextPage();
      expect(component.offset()).toBe(40);
    });

    it('prevPage decrements offset by PAGE_SIZE (20)', () => {
      const { component } = makeComponent();
      component.offset.set(40);
      component.prevPage();
      expect(component.offset()).toBe(20);
    });

    it('prevPage does not go below 0', () => {
      const { component } = makeComponent();
      component.offset.set(0);
      component.prevPage();
      expect(component.offset()).toBe(0);
    });

    it('currentPage is 1 when offset is 0', () => {
      const { component } = makeComponent();
      expect(component.currentPage()).toBe(1);
    });

    it('currentPage is 2 when offset is 20', () => {
      const { component } = makeComponent();
      component.offset.set(20);
      expect(component.currentPage()).toBe(2);
    });

    it('pageCount is 1 when total is 0', () => {
      const { component } = makeComponent();
      expect(component.pageCount()).toBe(1);
    });

    it('pageCount is 1 when total equals PAGE_SIZE', () => {
      const { component } = makeComponent();
      component.total.set(20);
      expect(component.pageCount()).toBe(1);
    });

    it('pageCount is 2 when total is PAGE_SIZE + 1', () => {
      const { component } = makeComponent();
      component.total.set(21);
      expect(component.pageCount()).toBe(2);
    });
  });

  // ── loadProducts via effect ────────────────────────────────────────────────

  describe('loadProducts (triggered via effect)', () => {
    it('sets loading=true synchronously when called', () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));

      triggerEffect();

      expect(component.loading()).toBe(true);
    });

    it('sets loading=false and populates products after response', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse([MOCK_PRODUCT], 1)));

      triggerEffect();
      await flushPromises();

      expect(component.loading()).toBe(false);
      expect(component.products()).toHaveLength(1);
      expect(component.products()[0]).toEqual(MOCK_PRODUCT);
    });

    it('sets total from the response', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse([MOCK_PRODUCT], 42)));

      triggerEffect();
      await flushPromises();

      expect(component.total()).toBe(42);
    });

    it('sets products=[] and total=0 on API error', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(throwError(() => ({ status: 500 })));
      // Seed some previous data to ensure it's cleared
      component.products.set([MOCK_PRODUCT]);
      component.total.set(5);

      triggerEffect();
      await flushPromises();

      expect(component.products()).toHaveLength(0);
      expect(component.total()).toBe(0);
      expect(component.loading()).toBe(false);
    });

    it('passes searchQuery to productSvc.search', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.searchQuery.set('widget');

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'widget' }),
      );
    });

    it('passes q=undefined when searchQuery is empty (ProductService drops undefined params)', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.searchQuery.set('');

      triggerEffect();
      await flushPromises();

      const call = productSvc.search.mock.calls[0]![0];
      expect(call.q).toBeUndefined();
    });

    it('passes brand to productSvc.search', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.brand.set('Nike');

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'Nike' }),
      );
    });

    it('passes available=true to productSvc.search when filter is on', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.available.set(true);

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ available: true }),
      );
    });

    it('passes sortBy to productSvc.search', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.sortBy.set('price_asc');

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'price_asc' }),
      );
    });

    it('passes offset to productSvc.search', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.offset.set(20);

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 20 }),
      );
    });

    it('always passes limit=20 to productSvc.search', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('parses minPrice as a float when minPriceRaw is set', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.minPriceRaw.set('9.99');

      triggerEffect();
      await flushPromises();

      expect(productSvc.search).toHaveBeenCalledWith(
        expect.objectContaining({ minPrice: 9.99 }),
      );
    });

    it('omits minPrice when minPriceRaw is empty', async () => {
      const { component, productSvc } = makeComponent();
      productSvc.search.mockReturnValue(of(mockResponse()));
      component.minPriceRaw.set('');

      triggerEffect();
      await flushPromises();

      const call = productSvc.search.mock.calls[0]![0];
      expect(call.minPrice).toBeUndefined();
    });
  });
});
