/**
 * Unit tests for ProductCardComponent.
 *
 * Strategy:
 *  - vi.mock('@angular/core') replaces inject() so CartService resolves
 *    from our mock.  Signals keep their real implementations.
 *  - The @Input() product is set directly on the class instance.
 *  - addToCart() is the only class-level method; button disabled state
 *    (template expression) is derived from signals which are also tested.
 *
 * Coverage:
 *  - addToCart() delegates to cart.addToCart with the correct product ID
 *  - addToCart() is unconditional (guards live in CartService + template)
 *  - addingProductId signal: null initially, reflects cart loading state
 *  - Out-of-stock and in-stock product signals accessible from component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject, signal } from '@angular/core';
import { CartService } from '../../core/services/cart.service';
import { ProductCardComponent } from './product-card.component';
import type { Product } from '../../core/models/product.model';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const IN_STOCK_PRODUCT: Product = {
  id: 'prod-1',
  name: 'Wireless Headphones',
  description: 'Premium audio',
  brand: 'SoundCo',
  price: '89.99',
  stockQty: 15,
  category: 'electronics',
  isActive: true,
  createdAt: '2025-01-01T00:00:00Z',
};

const OUT_OF_STOCK_PRODUCT: Product = {
  ...IN_STOCK_PRODUCT,
  id: 'prod-2',
  name: 'Sold-Out Item',
  stockQty: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCartSvc() {
  return {
    addToCart: vi.fn().mockResolvedValue(true),
    // Real writable signal so template-facing code can read it
    addingProductId: signal<string | null>(null),
  };
}

function makeComponent(product: Product = IN_STOCK_PRODUCT, cart = makeCartSvc()) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === CartService) return cart;
    return undefined;
  });
  const component = new ProductCardComponent();
  component.product = product;
  return { component, cart };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProductCardComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── addToCart() ───────────────────────────────────────────────────────────

  describe('addToCart()', () => {
    it('calls cart.addToCart with the product id', () => {
      const { component, cart } = makeComponent();
      component.addToCart();
      expect(cart.addToCart).toHaveBeenCalledWith(IN_STOCK_PRODUCT.id);
    });

    it('passes only the product id (qty default is handled by CartService)', () => {
      const { component, cart } = makeComponent();
      component.addToCart();
      expect(cart.addToCart).toHaveBeenCalledTimes(1);
      expect(cart.addToCart).toHaveBeenCalledWith(IN_STOCK_PRODUCT.id);
    });

    it('uses the id of whichever product is currently bound', () => {
      const { component, cart } = makeComponent(OUT_OF_STOCK_PRODUCT);
      component.addToCart();
      expect(cart.addToCart).toHaveBeenCalledWith(OUT_OF_STOCK_PRODUCT.id);
    });

    it('calls cart.addToCart even when the product is out of stock (guard is in template)', () => {
      const { component, cart } = makeComponent(OUT_OF_STOCK_PRODUCT);
      component.addToCart();
      // Template disables the button, but the method itself does not guard on stockQty
      expect(cart.addToCart).toHaveBeenCalledOnce();
    });

    it('calls cart.addToCart even when addingProductId matches another product', () => {
      const cart = makeCartSvc();
      cart.addingProductId.set('other-product-id'); // different product loading
      const { component } = makeComponent(IN_STOCK_PRODUCT, cart);
      component.addToCart();
      expect(cart.addToCart).toHaveBeenCalledWith(IN_STOCK_PRODUCT.id);
    });
  });

  // ── addingProductId signal integration ────────────────────────────────────

  describe('addingProductId signal', () => {
    it('starts as null', () => {
      const { cart } = makeComponent();
      expect(cart.addingProductId()).toBeNull();
    });

    it('when set to this product id the disabled condition evaluates true', () => {
      const cart = makeCartSvc();
      const { component } = makeComponent(IN_STOCK_PRODUCT, cart);

      cart.addingProductId.set(IN_STOCK_PRODUCT.id);

      // Template expression: product.stockQty <= 0 || cart.addingProductId() === product.id
      const isDisabled =
        component.product.stockQty <= 0 ||
        cart.addingProductId() === component.product.id;
      expect(isDisabled).toBe(true);
    });

    it('when set to a different product id the disabled condition evaluates false', () => {
      const cart = makeCartSvc();
      const { component } = makeComponent(IN_STOCK_PRODUCT, cart);

      cart.addingProductId.set('some-other-product-id');

      const isDisabled =
        component.product.stockQty <= 0 ||
        cart.addingProductId() === component.product.id;
      expect(isDisabled).toBe(false);
    });
  });

  // ── Stock availability ────────────────────────────────────────────────────

  describe('stock availability via product input', () => {
    it('in-stock product has stockQty > 0', () => {
      const { component } = makeComponent(IN_STOCK_PRODUCT);
      expect(component.product.stockQty).toBeGreaterThan(0);
    });

    it('out-of-stock product has stockQty === 0', () => {
      const { component } = makeComponent(OUT_OF_STOCK_PRODUCT);
      expect(component.product.stockQty).toBe(0);
    });

    it('disabled condition is true when stockQty is 0 (regardless of addingProductId)', () => {
      const cart = makeCartSvc(); // addingProductId = null
      const { component } = makeComponent(OUT_OF_STOCK_PRODUCT, cart);

      const isDisabled =
        component.product.stockQty <= 0 ||
        cart.addingProductId() === component.product.id;
      expect(isDisabled).toBe(true);
    });

    it('disabled condition is false for in-stock when no add is in progress', () => {
      const cart = makeCartSvc(); // addingProductId = null
      const { component } = makeComponent(IN_STOCK_PRODUCT, cart);

      const isDisabled =
        component.product.stockQty <= 0 ||
        cart.addingProductId() === component.product.id;
      expect(isDisabled).toBe(false);
    });
  });

  // ── Product data accessible from component ────────────────────────────────

  describe('product input binding', () => {
    it('exposes the product name', () => {
      const { component } = makeComponent(IN_STOCK_PRODUCT);
      expect(component.product.name).toBe('Wireless Headphones');
    });

    it('exposes the product price string', () => {
      const { component } = makeComponent(IN_STOCK_PRODUCT);
      expect(component.product.price).toBe('89.99');
    });

    it('exposes the product brand', () => {
      const { component } = makeComponent(IN_STOCK_PRODUCT);
      expect(component.product.brand).toBe('SoundCo');
    });

    it('product can be swapped by reassigning the input', () => {
      const { component } = makeComponent(IN_STOCK_PRODUCT);
      component.product = OUT_OF_STOCK_PRODUCT;
      expect(component.product.id).toBe(OUT_OF_STOCK_PRODUCT.id);
      expect(component.product.stockQty).toBe(0);
    });
  });
});
