/**
 * Unit tests for CartComponent.
 *
 * Strategy:
 *  - vi.mock('@angular/core') replaces inject() so CartService, ToastService,
 *    and Router resolve from mocks. Signals keep their real implementations.
 *  - ngOnInit() is called manually to trigger loadCart().
 *  - vi.useFakeTimers() is used per-test for countdown / expiry tests.
 *
 * Coverage:
 *  - Initial signal state
 *  - loadCart(): sets cart, loading, starts timer when secondsRemaining > 0
 *  - lineTotal(): pure price × qty calculation
 *  - total computed: sum of all line totals
 *  - isWarning / isCritical computed thresholds
 *  - countdownLabel formatting
 *  - changeQty(): guards, delegates, updates cart signal on success
 *  - removeItem(): guards, delegates, filters cart signal on success
 *  - placeOrder(): guard, delegates, sets pickupCode / orderId / clears cart
 *  - Countdown timer: decrements, triggers onExpired at zero
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { CartComponent } from './cart.component';
import { CartService } from '../../core/services/cart.service';
import { ToastService } from '../../core/services/toast.service';
import type { CartDetail, CartItem } from '../../core/models/order.model';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ITEM_A: CartItem = {
  id: 'item-a',
  productId: 'prod-1',
  productName: 'Widget A',
  price: '10.00',
  qty: 2,
};

const ITEM_B: CartItem = {
  id: 'item-b',
  productId: 'prod-2',
  productName: 'Widget B',
  price: '5.50',
  qty: 1,
};

function makeCart(secondsRemaining = 1500, items: CartItem[] = [ITEM_A, ITEM_B]): CartDetail {
  return { id: 'cart-1', items, secondsRemaining };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCartSvc(cart: CartDetail | null = makeCart()) {
  return {
    getCart:    vi.fn().mockResolvedValue(cart),
    updateQty:  vi.fn().mockResolvedValue(true),
    removeItem: vi.fn().mockResolvedValue(true),
    placeOrder: vi.fn().mockResolvedValue({ pickupCode: '123456', id: 'order-xyz' }),
  };
}

function makeToast() {
  return { warning: vi.fn(), success: vi.fn(), error: vi.fn() };
}

function makeRouter() {
  return { navigate: vi.fn().mockResolvedValue(true) };
}

function makeComponent(
  cartSvc = makeCartSvc(),
  toast   = makeToast(),
  router  = makeRouter(),
) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === CartService) return cartSvc;
    if (token === ToastService) return toast;
    if (token === Router) return router;
    return undefined;
  });
  const component = new CartComponent();
  return { component, cartSvc, toast, router };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CartComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial signal state ───────────────────────────────────────────────────

  describe('initial state', () => {
    it('loading starts true', () => {
      const { component } = makeComponent();
      expect(component.loading()).toBe(true);
    });

    it('cart starts null', () => {
      const { component } = makeComponent();
      expect(component.cart()).toBeNull();
    });

    it('countdown starts at 0', () => {
      const { component } = makeComponent();
      expect(component.countdown()).toBe(0);
    });

    it('placingOrder starts false', () => {
      const { component } = makeComponent();
      expect(component.placingOrder()).toBe(false);
    });

    it('updatingItemId starts null', () => {
      const { component } = makeComponent();
      expect(component.updatingItemId()).toBeNull();
    });

    it('deletingItemId starts null', () => {
      const { component } = makeComponent();
      expect(component.deletingItemId()).toBeNull();
    });

    it('pickupCode starts null', () => {
      const { component } = makeComponent();
      expect(component.pickupCode()).toBeNull();
    });

    it('orderId starts null', () => {
      const { component } = makeComponent();
      expect(component.orderId()).toBeNull();
    });
  });

  // ── ngOnInit / loadCart() ──────────────────────────────────────────────────

  describe('ngOnInit() / loadCart()', () => {
    it('sets cart from cartSvc.getCart()', async () => {
      const cart = makeCart();
      const { component } = makeComponent(makeCartSvc(cart));
      await component.ngOnInit();
      expect(component.cart()).toEqual(cart);
    });

    it('sets loading to false after load', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('sets loading false even when getCart returns null', async () => {
      const { component } = makeComponent(makeCartSvc(null));
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('sets countdown to secondsRemaining when cart has time left', async () => {
      const cartSvc = makeCartSvc(makeCart(450));
      const { component } = makeComponent(cartSvc);
      vi.useFakeTimers();
      try {
        await component.ngOnInit();
        expect(component.countdown()).toBe(450);
      } finally {
        component.ngOnDestroy();
        vi.useRealTimers();
      }
    });

    it('does not set countdown when secondsRemaining is 0', async () => {
      const cartSvc = makeCartSvc(makeCart(0));
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      expect(component.countdown()).toBe(0);
    });

    it('does not set countdown when cart is null', async () => {
      const { component } = makeComponent(makeCartSvc(null));
      await component.ngOnInit();
      expect(component.countdown()).toBe(0);
    });
  });

  // ── lineTotal() ───────────────────────────────────────────────────────────

  describe('lineTotal()', () => {
    it('returns price × qty as a 2-decimal string', () => {
      const { component } = makeComponent();
      expect(component.lineTotal(ITEM_A)).toBe('20.00'); // 10.00 × 2
    });

    it('handles single-unit items', () => {
      const { component } = makeComponent();
      expect(component.lineTotal(ITEM_B)).toBe('5.50'); // 5.50 × 1
    });

    it('handles fractional prices correctly', () => {
      const { component } = makeComponent();
      const item: CartItem = { ...ITEM_A, price: '3.33', qty: 3 };
      expect(component.lineTotal(item)).toBe('9.99');
    });
  });

  // ── total computed ─────────────────────────────────────────────────────────

  describe('total computed', () => {
    it('returns 0.00 when cart is null', () => {
      const { component } = makeComponent(makeCartSvc(null));
      expect(component.total()).toBe('0.00');
    });

    it('sums all line totals', async () => {
      const { component } = makeComponent(makeCartSvc(makeCart(0, [ITEM_A, ITEM_B])));
      await component.ngOnInit();
      // 10.00×2 + 5.50×1 = 25.50
      expect(component.total()).toBe('25.50');
    });

    it('updates when cart signal changes', async () => {
      const { component } = makeComponent(makeCartSvc(makeCart(0, [ITEM_A])));
      await component.ngOnInit();
      expect(component.total()).toBe('20.00');
      component.cart.update((c) =>
        c ? { ...c, items: [...c.items, ITEM_B] } : c,
      );
      expect(component.total()).toBe('25.50');
    });
  });

  // ── isWarning / isCritical computed ───────────────────────────────────────

  describe('isWarning computed', () => {
    it('is false when countdown is 0', () => {
      const { component } = makeComponent();
      component.countdown.set(0);
      expect(component.isWarning()).toBe(false);
    });

    it('is false when countdown >= 300', () => {
      const { component } = makeComponent();
      component.countdown.set(300);
      expect(component.isWarning()).toBe(false);
    });

    it('is true when countdown is between 1 and 299', () => {
      const { component } = makeComponent();
      component.countdown.set(299);
      expect(component.isWarning()).toBe(true);
    });

    it('is true at countdown 60 (also within isCritical threshold)', () => {
      const { component } = makeComponent();
      component.countdown.set(60);
      expect(component.isWarning()).toBe(true);
    });
  });

  describe('isCritical computed', () => {
    it('is false when countdown is 0', () => {
      const { component } = makeComponent();
      component.countdown.set(0);
      expect(component.isCritical()).toBe(false);
    });

    it('is false when countdown >= 60', () => {
      const { component } = makeComponent();
      component.countdown.set(60);
      expect(component.isCritical()).toBe(false);
    });

    it('is true when countdown is between 1 and 59', () => {
      const { component } = makeComponent();
      component.countdown.set(59);
      expect(component.isCritical()).toBe(true);
    });

    it('is true at countdown 1', () => {
      const { component } = makeComponent();
      component.countdown.set(1);
      expect(component.isCritical()).toBe(true);
    });
  });

  // ── countdownLabel computed ────────────────────────────────────────────────

  describe('countdownLabel computed', () => {
    it('formats 90 seconds as "1:30"', () => {
      const { component } = makeComponent();
      component.countdown.set(90);
      expect(component.countdownLabel()).toBe('1:30');
    });

    it('pads seconds below 10 with a leading zero', () => {
      const { component } = makeComponent();
      component.countdown.set(65);
      expect(component.countdownLabel()).toBe('1:05');
    });

    it('formats 0 seconds as "0:00"', () => {
      const { component } = makeComponent();
      component.countdown.set(0);
      expect(component.countdownLabel()).toBe('0:00');
    });

    it('formats 1800 seconds as "30:00"', () => {
      const { component } = makeComponent();
      component.countdown.set(1800);
      expect(component.countdownLabel()).toBe('30:00');
    });

    it('formats 59 seconds as "0:59"', () => {
      const { component } = makeComponent();
      component.countdown.set(59);
      expect(component.countdownLabel()).toBe('0:59');
    });
  });

  // ── changeQty() ───────────────────────────────────────────────────────────

  describe('changeQty()', () => {
    it('calls cartSvc.updateQty with item id and new qty', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.changeQty(ITEM_A, 3);
      expect(cartSvc.updateQty).toHaveBeenCalledWith(ITEM_A.id, 3);
    });

    it('does nothing when newQty is less than 1', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.changeQty(ITEM_A, 0);
      expect(cartSvc.updateQty).not.toHaveBeenCalled();
    });

    it('does nothing when newQty is negative', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.changeQty(ITEM_A, -1);
      expect(cartSvc.updateQty).not.toHaveBeenCalled();
    });

    it('does nothing when updatingItemId already matches the item', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      component.updatingItemId.set(ITEM_A.id);
      await component.changeQty(ITEM_A, 3);
      expect(cartSvc.updateQty).not.toHaveBeenCalled();
    });

    it('updates the item qty in the cart signal on success', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.changeQty(ITEM_A, 5);
      const updated = component.cart()!.items.find((i) => i.id === ITEM_A.id);
      expect(updated!.qty).toBe(5);
    });

    it('does not update the cart signal when updateQty returns false', async () => {
      const cartSvc = makeCartSvc();
      cartSvc.updateQty.mockResolvedValue(false);
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.changeQty(ITEM_A, 5);
      const unchanged = component.cart()!.items.find((i) => i.id === ITEM_A.id);
      expect(unchanged!.qty).toBe(ITEM_A.qty); // original qty
    });

    it('clears updatingItemId after completion', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.changeQty(ITEM_A, 3);
      expect(component.updatingItemId()).toBeNull();
    });

    it('does not change other items when one is updated', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.changeQty(ITEM_A, 10);
      const itemB = component.cart()!.items.find((i) => i.id === ITEM_B.id);
      expect(itemB!.qty).toBe(ITEM_B.qty);
    });
  });

  // ── removeItem() ──────────────────────────────────────────────────────────

  describe('removeItem()', () => {
    it('calls cartSvc.removeItem with the item id', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.removeItem(ITEM_A);
      expect(cartSvc.removeItem).toHaveBeenCalledWith(ITEM_A.id);
    });

    it('does nothing when deletingItemId already matches the item', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      component.deletingItemId.set(ITEM_A.id);
      await component.removeItem(ITEM_A);
      expect(cartSvc.removeItem).not.toHaveBeenCalled();
    });

    it('removes the item from the cart signal on success', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.removeItem(ITEM_A);
      const items = component.cart()!.items;
      expect(items.find((i) => i.id === ITEM_A.id)).toBeUndefined();
    });

    it('keeps other items when one is removed', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.removeItem(ITEM_A);
      const items = component.cart()!.items;
      expect(items.find((i) => i.id === ITEM_B.id)).toBeDefined();
    });

    it('does not remove from cart signal when removeItem returns false', async () => {
      const cartSvc = makeCartSvc();
      cartSvc.removeItem.mockResolvedValue(false);
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.removeItem(ITEM_A);
      const items = component.cart()!.items;
      expect(items.find((i) => i.id === ITEM_A.id)).toBeDefined();
    });

    it('clears deletingItemId after completion', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.removeItem(ITEM_A);
      expect(component.deletingItemId()).toBeNull();
    });
  });

  // ── placeOrder() ──────────────────────────────────────────────────────────

  describe('placeOrder()', () => {
    it('calls cartSvc.placeOrder', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.placeOrder();
      expect(cartSvc.placeOrder).toHaveBeenCalledOnce();
    });

    it('does nothing when placingOrder is already true', async () => {
      const cartSvc = makeCartSvc();
      const { component } = makeComponent(cartSvc);
      component.placingOrder.set(true);
      await component.placeOrder();
      expect(cartSvc.placeOrder).not.toHaveBeenCalled();
    });

    it('sets pickupCode from the result', async () => {
      const cartSvc = makeCartSvc();
      cartSvc.placeOrder.mockResolvedValue({ pickupCode: '654321', id: 'ord-1' });
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.placeOrder();
      expect(component.pickupCode()).toBe('654321');
    });

    it('sets orderId from the result', async () => {
      const cartSvc = makeCartSvc();
      cartSvc.placeOrder.mockResolvedValue({ pickupCode: '654321', id: 'ord-abc' });
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.placeOrder();
      expect(component.orderId()).toBe('ord-abc');
    });

    it('clears the cart signal on success', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.placeOrder();
      expect(component.cart()).toBeNull();
    });

    it('does not set pickupCode when result is null', async () => {
      const cartSvc = makeCartSvc();
      cartSvc.placeOrder.mockResolvedValue(null);
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      await component.placeOrder();
      expect(component.pickupCode()).toBeNull();
    });

    it('resets placingOrder to false after completion', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      await component.placeOrder();
      expect(component.placingOrder()).toBe(false);
    });
  });

  // ── Countdown timer ───────────────────────────────────────────────────────

  describe('countdown timer', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('decrements countdown by 1 each second', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(10));
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      expect(component.countdown()).toBe(10);
      vi.advanceTimersByTime(3000);
      expect(component.countdown()).toBe(7);
      component.ngOnDestroy();
    });

    it('reaches zero after secondsRemaining seconds', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(5));
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      vi.advanceTimersByTime(5000);
      expect(component.countdown()).toBe(0);
    });

    it('clears the cart on expiry', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(2));
      const { component } = makeComponent(cartSvc);
      await component.ngOnInit();
      vi.advanceTimersByTime(2000);
      expect(component.cart()).toBeNull();
    });

    it('calls toast.warning on expiry', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(2));
      const toast = makeToast();
      const { component } = makeComponent(cartSvc, toast);
      await component.ngOnInit();
      vi.advanceTimersByTime(2000);
      expect(toast.warning).toHaveBeenCalledOnce();
    });

    it('navigates to /catalog on expiry', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(2));
      const router = makeRouter();
      const { component } = makeComponent(cartSvc, makeToast(), router);
      await component.ngOnInit();
      vi.advanceTimersByTime(2000);
      expect(router.navigate).toHaveBeenCalledWith(['/catalog']);
    });

    it('does not start a timer when secondsRemaining is 0', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(0));
      const toast = makeToast();
      const { component } = makeComponent(cartSvc, toast);
      await component.ngOnInit();
      vi.advanceTimersByTime(5000);
      expect(component.countdown()).toBe(0);
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('stops the timer on ngOnDestroy', async () => {
      vi.useFakeTimers();
      const cartSvc = makeCartSvc(makeCart(30));
      const toast = makeToast();
      const { component } = makeComponent(cartSvc, toast);
      await component.ngOnInit();
      expect(component.countdown()).toBe(30);
      component.ngOnDestroy();
      vi.advanceTimersByTime(30000); // would expire but timer is cleared
      expect(toast.warning).not.toHaveBeenCalled();
    });
  });
});
