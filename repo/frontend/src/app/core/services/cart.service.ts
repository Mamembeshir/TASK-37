import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import type { CartDetail, CreateOrderResponse } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  /** Set to productId while add-to-cart is in flight — lets cards show per-product spinners. */
  readonly addingProductId = signal<string | null>(null);

  // ── Cart retrieval ────────────────────────────────────────────────────────

  async getCart(): Promise<CartDetail | null> {
    try {
      return await firstValueFrom(this.api.get<CartDetail>('/cart'));
    } catch (e: unknown) {
      if ((e as HttpErrorResponse).status === 404) return null;
      throw e;
    }
  }

  // ── Item management ───────────────────────────────────────────────────────

  /**
   * Update quantity of a cart item.  Returns the updated CartItem on success.
   * Surfaces backend errors via toast; returns null on failure.
   */
  async updateQty(itemId: string, qty: number): Promise<boolean> {
    try {
      await firstValueFrom(this.api.put(`/cart/items/${itemId}`, { qty }));
      return true;
    } catch (e: unknown) {
      const err = e as HttpErrorResponse;
      if (err.status === 409) {
        this.toast.error('Insufficient stock to increase quantity');
        return false;
      }
      const msg: string = (err.error as { error?: string })?.error ?? 'Could not update quantity';
      this.toast.error(msg);
      return false;
    }
  }

  /** Remove a cart item and release stock. Returns true on success. */
  async removeItem(itemId: string): Promise<boolean> {
    try {
      await firstValueFrom(this.api.delete(`/cart/items/${itemId}`));
      return true;
    } catch (e: unknown) {
      const msg: string = ((e as HttpErrorResponse).error as { error?: string })?.error ?? 'Could not remove item';
      this.toast.error(msg);
      return false;
    }
  }

  // ── Order placement ───────────────────────────────────────────────────────

  /**
   * Convert the active cart into an order.
   * Returns the CreateOrderResponse (which includes the one-time pickupCode).
   * Returns null on any error and shows a toast.
   */
  async placeOrder(): Promise<CreateOrderResponse | null> {
    try {
      return await firstValueFrom(this.api.post<CreateOrderResponse>('/orders', {}));
    } catch (e: unknown) {
      const err = e as HttpErrorResponse;
      const msg: string = (err.error as { error?: string })?.error ?? 'Could not place order';
      this.toast.error(msg);
      return null;
    }
  }

  // ── Add to cart (catalog-facing) ─────────────────────────────────────────

  /** Add a product to the cart. Auto-creates a cart if none exists. */
  async addToCart(productId: string, qty = 1): Promise<boolean> {
    if (this.addingProductId() === productId) return false;
    this.addingProductId.set(productId);

    try {
      await firstValueFrom(this.api.post('/cart/items', { productId, qty }));
      this.toast.success('Added to cart');
      return true;
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status === 404) return this.createCartAndAdd(productId, qty);
      if (e.status === 409) { this.toast.warning('Already in your cart'); return false; }
      if (e.status === 410) { this.toast.error('Your cart expired — please start a new cart'); return false; }
      const msg: string = (e.error as { error?: string })?.error ?? 'Could not add to cart';
      this.toast.error(msg);
      return false;
    } finally {
      this.addingProductId.set(null);
    }
  }

  private async createCartAndAdd(productId: string, qty: number): Promise<boolean> {
    try {
      await firstValueFrom(this.api.post('/cart', {}));
      await firstValueFrom(this.api.post('/cart/items', { productId, qty }));
      this.toast.success('Added to cart');
      return true;
    } catch (retryErr: unknown) {
      const r = retryErr as HttpErrorResponse;
      const msg: string = (r.error as { error?: string })?.error ?? 'Could not add to cart';
      this.toast.error(msg);
      return false;
    } finally {
      this.addingProductId.set(null);
    }
  }
}
