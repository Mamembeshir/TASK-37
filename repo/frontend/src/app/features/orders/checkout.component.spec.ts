/**
 * Unit tests for CheckoutComponent.
 *
 * Strategy:
 *  - vi.mock('@angular/core') replaces inject() so OrderService, ToastService,
 *    and ActivatedRoute resolve from mocks.  Signals keep their real implementations.
 *  - OrderService methods return RxJS Observables; mocked with of() / throwError().
 *  - ngOnInit() is called manually to trigger loadOrder().
 *
 * Coverage:
 *  - Initial signal state
 *  - ngOnInit(): reads route param, calls loadOrder, sets error when id is missing
 *  - loadOrder(): sets order on success, sets error on failure
 *  - activeItems computed: excludes items with cancelledAt set
 *  - orderTotal computed: sum of active item line totals
 *  - tenderTotal / balanceCents / balance computed
 *  - lineTotal(): pure qty × unitPrice calculation
 *  - addTender(): amount validation, card reference validation, appends split, resets form
 *  - confirmOrder(): guard (balanceCents !== 0), delegates, reloads order
 *  - onMethodChange(): clears reference when switching to cash
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CheckoutComponent } from './checkout.component';
import { OrderService } from '../../core/services/order.service';
import { ToastService } from '../../core/services/toast.service';
import type { OrderDetail, TenderSplit } from '../../core/models/order.model';

// ── Mock @angular/core: keep signals real, replace inject ────────────────────

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, inject: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOrderItem(overrides: Partial<{
  id: string; productName: string; unitPrice: string; qty: number; cancelledAt: string | null;
}> = {}) {
  return {
    id: 'item-1',
    productName: 'Wireless Headphones',
    unitPrice: '89.99',
    qty: 1,
    cancelledAt: null,
    ...overrides,
  };
}

function makeTenderSplit(overrides: Partial<TenderSplit> = {}): TenderSplit {
  return {
    id: 'split-1',
    method: 'cash',
    amount: '50.00',
    reference: null,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-uuid-1',
    status: 'pending',
    items: [makeOrderItem()],
    tenderSplits: [],
    ...overrides,
  } as OrderDetail;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrderSvc(order: OrderDetail = makeOrder()) {
  return {
    getOrder:     vi.fn().mockReturnValue(of(order)),
    addTender:    vi.fn().mockReturnValue(of(makeTenderSplit())),
    confirmOrder: vi.fn().mockReturnValue(of({})),
  };
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
}

function makeRoute(id: string | null = 'order-uuid-1') {
  return {
    snapshot: {
      paramMap: { get: vi.fn().mockReturnValue(id) },
    },
  };
}

function makeComponent(
  orderSvc = makeOrderSvc(),
  toast    = makeToast(),
  route    = makeRoute(),
) {
  vi.mocked(inject).mockImplementation((token: unknown) => {
    if (token === OrderService)   return orderSvc;
    if (token === ToastService)   return toast;
    if (token === ActivatedRoute) return route;
    return undefined;
  });
  const component = new CheckoutComponent();
  return { component, orderSvc, toast, route };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CheckoutComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('loading starts true', () => {
      const { component } = makeComponent();
      expect(component.loading()).toBe(true);
    });

    it('order starts null', () => {
      const { component } = makeComponent();
      expect(component.order()).toBeNull();
    });

    it('error starts null', () => {
      const { component } = makeComponent();
      expect(component.error()).toBeNull();
    });

    it('addingTender starts false', () => {
      const { component } = makeComponent();
      expect(component.addingTender()).toBe(false);
    });

    it('confirming starts false', () => {
      const { component } = makeComponent();
      expect(component.confirming()).toBe(false);
    });

    it('tenderError starts null', () => {
      const { component } = makeComponent();
      expect(component.tenderError()).toBeNull();
    });

    it('tender form starts with cash method and empty fields', () => {
      const { component } = makeComponent();
      expect(component.tender.method).toBe('cash');
      expect(component.tender.amount).toBe('');
      expect(component.tender.reference).toBe('');
    });
  });

  // ── ngOnInit() — route reading ─────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('calls orderSvc.getOrder with the route id param', async () => {
      const orderSvc = makeOrderSvc();
      const { component } = makeComponent(orderSvc, makeToast(), makeRoute('abc-123'));
      await component.ngOnInit();
      expect(orderSvc.getOrder).toHaveBeenCalledWith('abc-123');
    });

    it('sets order signal on successful load', async () => {
      const order = makeOrder();
      const { component } = makeComponent(makeOrderSvc(order));
      await component.ngOnInit();
      expect(component.order()).toEqual(order);
    });

    it('sets loading to false after load', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('shows error toast when route id is null and does not call getOrder', async () => {
      const orderSvc = makeOrderSvc();
      const toast = makeToast();
      const { component } = makeComponent(orderSvc, toast, makeRoute(null));
      await component.ngOnInit();
      expect(toast.error).toHaveBeenCalledWith('Missing order ID.');
      expect(orderSvc.getOrder).not.toHaveBeenCalled();
    });

    it('sets loading to false when route id is null', async () => {
      const { component } = makeComponent(makeOrderSvc(), makeToast(), makeRoute(null));
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('shows error toast when getOrder throws', async () => {
      const orderSvc = makeOrderSvc();
      orderSvc.getOrder.mockReturnValue(throwError(() => ({ status: 404 })));
      const toast = makeToast();
      const { component } = makeComponent(orderSvc, toast);
      await component.ngOnInit();
      expect(toast.error).toHaveBeenCalledWith('Order not found or access denied.');
    });

    it('sets loading to false when getOrder throws', async () => {
      const orderSvc = makeOrderSvc();
      orderSvc.getOrder.mockReturnValue(throwError(() => new Error('Network error')));
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      expect(component.loading()).toBe(false);
    });
  });

  // ── activeItems computed ───────────────────────────────────────────────────

  describe('activeItems computed', () => {
    it('returns empty array when order is null', () => {
      const { component } = makeComponent();
      expect(component.activeItems()).toEqual([]);
    });

    it('includes items where cancelledAt is null', async () => {
      const item = makeOrderItem({ cancelledAt: null });
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [item] })));
      await component.ngOnInit();
      expect(component.activeItems()).toHaveLength(1);
    });

    it('excludes items where cancelledAt is set', async () => {
      const active    = makeOrderItem({ id: 'a', cancelledAt: null });
      const cancelled = makeOrderItem({ id: 'b', cancelledAt: '2025-06-01T00:00:00Z' });
      const order = makeOrder({ items: [active, cancelled] });
      const { component } = makeComponent(makeOrderSvc(order));
      await component.ngOnInit();
      expect(component.activeItems()).toHaveLength(1);
      expect(component.activeItems()[0].id).toBe('a');
    });

    it('returns empty array when all items are cancelled', async () => {
      const cancelled = makeOrderItem({ cancelledAt: '2025-06-01T00:00:00Z' });
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [cancelled] })));
      await component.ngOnInit();
      expect(component.activeItems()).toHaveLength(0);
    });
  });

  // ── orderTotal computed ────────────────────────────────────────────────────

  describe('orderTotal computed', () => {
    it('returns 0.00 when order is null', () => {
      const { component } = makeComponent();
      expect(component.orderTotal()).toBe('0.00');
    });

    it('sums qty × unitPrice for all active items', async () => {
      const item1 = makeOrderItem({ unitPrice: '10.00', qty: 2 }); // 20.00
      const item2 = makeOrderItem({ id: 'i2', unitPrice: '5.50', qty: 1 }); // 5.50
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [item1, item2] })));
      await component.ngOnInit();
      expect(component.orderTotal()).toBe('25.50');
    });

    it('excludes cancelled items from total', async () => {
      const active    = makeOrderItem({ id: 'a', unitPrice: '20.00', qty: 1, cancelledAt: null });
      const cancelled = makeOrderItem({ id: 'b', unitPrice: '99.00', qty: 1, cancelledAt: '2025-01-01T00:00:00Z' });
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [active, cancelled] })));
      await component.ngOnInit();
      expect(component.orderTotal()).toBe('20.00');
    });
  });

  // ── tenderTotal / balanceCents / balance computed ─────────────────────────

  describe('tenderTotal computed', () => {
    it('returns 0.00 when no tender splits exist', async () => {
      const { component } = makeComponent(makeOrderSvc(makeOrder({ tenderSplits: [] })));
      await component.ngOnInit();
      expect(component.tenderTotal()).toBe('0.00');
    });

    it('sums all tender split amounts', async () => {
      const splits = [
        makeTenderSplit({ id: 's1', amount: '30.00' }),
        makeTenderSplit({ id: 's2', amount: '59.99' }),
      ];
      const { component } = makeComponent(makeOrderSvc(makeOrder({ tenderSplits: splits })));
      await component.ngOnInit();
      expect(component.tenderTotal()).toBe('89.99');
    });
  });

  describe('balanceCents computed', () => {
    it('is positive when tender is less than order total', async () => {
      const item   = makeOrderItem({ unitPrice: '100.00', qty: 1 });
      const split  = makeTenderSplit({ amount: '60.00' });
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [item], tenderSplits: [split] })));
      await component.ngOnInit();
      // orderTotalCents=10000, tenderTotalCents=6000 → balance=4000
      expect(component.balanceCents()).toBe(4000);
    });

    it('is zero when tender exactly equals order total', async () => {
      const item  = makeOrderItem({ unitPrice: '89.99', qty: 1 });
      const split = makeTenderSplit({ amount: '89.99' });
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [item], tenderSplits: [split] })));
      await component.ngOnInit();
      expect(component.balanceCents()).toBe(0);
    });

    it('is negative when tender exceeds order total (overpayment)', async () => {
      const item  = makeOrderItem({ unitPrice: '50.00', qty: 1 });
      const split = makeTenderSplit({ amount: '60.00' });
      const { component } = makeComponent(makeOrderSvc(makeOrder({ items: [item], tenderSplits: [split] })));
      await component.ngOnInit();
      expect(component.balanceCents()).toBe(-1000);
    });
  });

  // ── lineTotal() ───────────────────────────────────────────────────────────

  describe('lineTotal()', () => {
    it('returns qty × unitPrice as a 2-decimal string', () => {
      const { component } = makeComponent();
      expect(component.lineTotal(2, '10.00')).toBe('20.00');
    });

    it('handles fractional prices', () => {
      const { component } = makeComponent();
      expect(component.lineTotal(3, '3.33')).toBe('9.99');
    });
  });

  // ── addTender() — validation ───────────────────────────────────────────────

  describe('addTender() — validation', () => {
    it('calls toast.warning when amount is empty string', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.amount = '';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledWith('Enter a valid amount greater than zero.');
    });

    it('calls toast.warning when amount is zero', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.amount = '0';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledWith('Enter a valid amount greater than zero.');
    });

    it('calls toast.warning when amount is negative', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.amount = '-5';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledWith('Enter a valid amount greater than zero.');
    });

    it('calls toast.warning when amount is non-numeric', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.amount = 'abc';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledWith('Enter a valid amount greater than zero.');
    });

    it('calls toast.warning when method is card and reference is empty', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.method = 'card';
      component.tender.amount = '50.00';
      component.tender.reference = '';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledWith('Card reference is required for card tender.');
    });

    it('calls toast.warning when method is card and reference is whitespace only', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.method = 'card';
      component.tender.amount = '50.00';
      component.tender.reference = '   ';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledWith('Card reference is required for card tender.');
    });

    it('does not call orderSvc.addTender when validation fails', async () => {
      const orderSvc = makeOrderSvc();
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      component.tender.amount = '0';
      await component.addTender();
      expect(orderSvc.addTender).not.toHaveBeenCalled();
    });

    it('calls toast.warning on each invalid attempt', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender.amount = '0';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledTimes(1);
      component.tender.amount = '-1';
      await component.addTender();
      expect(toast.warning).toHaveBeenCalledTimes(2);
    });
  });

  // ── addTender() — success path ─────────────────────────────────────────────

  describe('addTender() — success', () => {
    it('calls orderSvc.addTender with correct payload for cash', async () => {
      const orderSvc = makeOrderSvc();
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '25.50', reference: '' };
      await component.addTender();
      expect(orderSvc.addTender).toHaveBeenCalledWith(
        'order-uuid-1',
        { method: 'cash', amount: '25.50', reference: null },
      );
    });

    it('passes card reference for card tender', async () => {
      const orderSvc = makeOrderSvc();
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      component.tender = { method: 'card', amount: '100.00', reference: 'REF-001' };
      await component.addTender();
      expect(orderSvc.addTender).toHaveBeenCalledWith(
        'order-uuid-1',
        { method: 'card', amount: '100.00', reference: 'REF-001' },
      );
    });

    it('appends returned split to order.tenderSplits', async () => {
      const newSplit = makeTenderSplit({ id: 'new-split', amount: '30.00' });
      const orderSvc = makeOrderSvc(makeOrder({ tenderSplits: [] }));
      orderSvc.addTender.mockReturnValue(of(newSplit));
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '30.00', reference: '' };
      await component.addTender();
      expect(component.order()!.tenderSplits).toHaveLength(1);
      expect(component.order()!.tenderSplits[0].id).toBe('new-split');
    });

    it('resets tender form to defaults after success', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      component.tender = { method: 'card', amount: '50.00', reference: 'REF-XYZ' };
      await component.addTender();
      expect(component.tender.method).toBe('cash');
      expect(component.tender.amount).toBe('');
      expect(component.tender.reference).toBe('');
    });

    it('clears tenderError after successful add', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      component.tenderError.set('some prior error');
      component.tender = { method: 'cash', amount: '10.00', reference: '' };
      await component.addTender();
      expect(component.tenderError()).toBeNull();
    });

    it('resets addingTender to false after completion', async () => {
      const { component } = makeComponent();
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '10.00', reference: '' };
      await component.addTender();
      expect(component.addingTender()).toBe(false);
    });

    it('calls toast.success on success', async () => {
      const toast = makeToast();
      const { component } = makeComponent(makeOrderSvc(), toast);
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '10.00', reference: '' };
      await component.addTender();
      expect(toast.success).toHaveBeenCalledOnce();
    });
  });

  // ── addTender() — error path ───────────────────────────────────────────────

  describe('addTender() — API error', () => {
    it('calls toast.error with the API error message', async () => {
      const orderSvc = makeOrderSvc();
      orderSvc.addTender.mockReturnValue(
        throwError(() => ({ error: { error: 'Payment gateway timeout' } })),
      );
      const toast = makeToast();
      const { component } = makeComponent(orderSvc, toast);
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '20.00', reference: '' };
      await component.addTender();
      expect(toast.error).toHaveBeenCalledWith('Payment gateway timeout');
    });

    it('calls toast.error with fallback message when API provides no message', async () => {
      const orderSvc = makeOrderSvc();
      orderSvc.addTender.mockReturnValue(throwError(() => ({})));
      const toast = makeToast();
      const { component } = makeComponent(orderSvc, toast);
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '20.00', reference: '' };
      await component.addTender();
      expect(toast.error).toHaveBeenCalledWith('Could not record payment');
    });

    it('resets addingTender to false on API error', async () => {
      const orderSvc = makeOrderSvc();
      orderSvc.addTender.mockReturnValue(throwError(() => ({})));
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      component.tender = { method: 'cash', amount: '20.00', reference: '' };
      await component.addTender();
      expect(component.addingTender()).toBe(false);
    });
  });

  // ── confirmOrder() ─────────────────────────────────────────────────────────

  describe('confirmOrder()', () => {
    async function makeBalancedComponent() {
      const item  = makeOrderItem({ unitPrice: '50.00', qty: 1 });
      const split = makeTenderSplit({ amount: '50.00' });
      const order = makeOrder({ items: [item], tenderSplits: [split] });
      const orderSvc = makeOrderSvc(order);
      // Reload returns same order
      orderSvc.getOrder.mockReturnValue(of(order));
      const { component, toast } = makeComponent(orderSvc, makeToast());
      await component.ngOnInit();
      return { component, orderSvc, toast };
    }

    it('calls orderSvc.confirmOrder when balance is zero', async () => {
      const { component, orderSvc } = await makeBalancedComponent();
      await component.confirmOrder();
      expect(orderSvc.confirmOrder).toHaveBeenCalledWith('order-uuid-1');
    });

    it('does nothing when balanceCents is not zero', async () => {
      const orderSvc = makeOrderSvc(); // order total 89.99, no splits → balance > 0
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      await component.confirmOrder();
      expect(orderSvc.confirmOrder).not.toHaveBeenCalled();
    });

    it('does nothing when confirming is already true', async () => {
      const { component, orderSvc } = await makeBalancedComponent();
      component.confirming.set(true);
      await component.confirmOrder();
      expect(orderSvc.confirmOrder).not.toHaveBeenCalled();
    });

    it('resets confirming to false after success', async () => {
      const { component } = await makeBalancedComponent();
      await component.confirmOrder();
      expect(component.confirming()).toBe(false);
    });

    it('calls toast.success on confirm success', async () => {
      const { component, toast } = await makeBalancedComponent();
      await component.confirmOrder();
      expect(toast.success).toHaveBeenCalledOnce();
    });

    it('calls toast.error on confirm failure', async () => {
      const item  = makeOrderItem({ unitPrice: '50.00', qty: 1 });
      const split = makeTenderSplit({ amount: '50.00' });
      const order = makeOrder({ items: [item], tenderSplits: [split] });
      const orderSvc = makeOrderSvc(order);
      orderSvc.confirmOrder.mockReturnValue(throwError(() => ({ error: { error: 'Already confirmed' } })));
      const toast = makeToast();
      const { component } = makeComponent(orderSvc, toast);
      await component.ngOnInit();
      await component.confirmOrder();
      expect(toast.error).toHaveBeenCalledOnce();
    });

    it('resets confirming to false on error', async () => {
      const item  = makeOrderItem({ unitPrice: '50.00', qty: 1 });
      const split = makeTenderSplit({ amount: '50.00' });
      const order = makeOrder({ items: [item], tenderSplits: [split] });
      const orderSvc = makeOrderSvc(order);
      orderSvc.confirmOrder.mockReturnValue(throwError(() => ({})));
      const { component } = makeComponent(orderSvc);
      await component.ngOnInit();
      await component.confirmOrder();
      expect(component.confirming()).toBe(false);
    });
  });

  // ── onMethodChange() ───────────────────────────────────────────────────────

  describe('onMethodChange()', () => {
    it('clears reference when method switches to cash', () => {
      const { component } = makeComponent();
      component.tender.reference = 'REF-001';
      component.tender.method = 'cash';
      component.onMethodChange();
      expect(component.tender.reference).toBe('');
    });

    it('does not clear reference when method is card', () => {
      const { component } = makeComponent();
      component.tender.reference = 'REF-001';
      component.tender.method = 'card';
      component.onMethodChange();
      expect(component.tender.reference).toBe('REF-001');
    });
  });
});
