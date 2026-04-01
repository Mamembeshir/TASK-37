import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import { ToastService } from '../../core/services/toast.service';
import type { CartDetail, CartItem } from '../../core/models/order.model';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    @media print {
      body * { visibility: hidden !important; }
      .pickup-print-zone, .pickup-print-zone * { visibility: visible !important; }
      .pickup-print-zone {
        position: fixed !important; inset: 0 !important;
        display: flex !important; flex-direction: column !important;
        align-items: center !important; justify-content: center !important;
        background: white !important; color: black !important;
        font-family: system-ui, sans-serif;
      }
      .pickup-print-zone .digit-box {
        border: 3px solid #000 !important;
        background: #fff !important;
        color: #000 !important;
      }
    }
  `],
  template: `
    <div class="mx-auto max-w-3xl px-4 sm:px-6 py-8 animate-fade-in">

      <!-- - Pickup code overlay - -->
      @if (pickupCode()) {
        <div class="fixed inset-0 z-50 bg-black/80
                    flex items-center justify-center p-4 animate-fade-in">
          <div class="w-full max-w-lg glass rounded-2xl p-8 sm:p-10 text-center pickup-print-zone">

            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full
                        bg-[#c4832a]/10 border border-[#c4832a]/20 mb-6">
              <svg class="w-8 h-8 text-[#c4832a]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>

            <h2 class="text-2xl font-bold text-zinc-900 mb-1">Order Placed!</h2>
            <p class="text-zinc-700 text-sm mb-8">
              Order <span class="font-mono text-zinc-700 text-xs">{{ orderId()!.slice(0,8).toUpperCase() }}...</span>
            </p>

            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-700 mb-3">
              Your 6-digit pickup code
            </p>

            <!-- Six digit boxes -->
            <div class="flex items-center justify-center gap-2 sm:gap-3 mb-6">
              @for (digit of pickupCodeDigits(); track $index) {
                <div class="digit-box w-11 h-14 sm:w-12 sm:h-15 rounded-xl
                            bg-zinc-900 border-2 border-[#c4832a]/30
                            flex items-center justify-center
                            text-2xl sm:text-3xl font-bold font-mono text-[#c4832a]
                            shadow-[0_0_24px_rgba(245,158,11,0.12)]">
                  {{ digit }}
                </div>
              }
            </div>

            <p class="text-zinc-700 text-xs mb-8 max-w-xs mx-auto leading-relaxed">
              This code is shown <strong class="text-zinc-700">once only</strong>.
              Print or memorise it before leaving this screen.
            </p>

            <div class="flex flex-col sm:flex-row gap-3 justify-center">
              <button type="button"
                class="btn-secondary flex items-center justify-center gap-2 py-2.5 px-5 text-sm"
                (click)="print()">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
                </svg>
                Print Code
              </button>
              <a routerLink="/catalog"
                class="btn-primary flex items-center justify-center gap-2 py-2.5 px-5 text-sm">
                Back to Catalog
              </a>
            </div>
          </div>
        </div>
      }

      <!-- - Header - -->
      <div class="flex items-start justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900">Your Cart</h1>
          @if (!loading() && cart()) {
            <p class="text-sm text-zinc-700 mt-0.5">
              {{ cart()!.items.length }} item{{ cart()!.items.length === 1 ? '' : 's' }}
            </p>
          }
        </div>

        @if (cart() && countdown() > 0) {
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border
                      text-xs font-semibold tabular-nums transition-colors"
               [class]="countdownBadgeClass()">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            {{ countdownLabel() }}
          </div>
        }
      </div>

      <!-- - Loading skeletons - -->
      @if (loading()) {
        <div class="space-y-3">
          @for (_ of [1,2,3]; track $index) {
            <div class="card p-4 flex gap-4 items-center">
              <div class="shimmer w-12 h-12 rounded-lg shrink-0"></div>
              <div class="flex-1 space-y-2">
                <div class="shimmer h-4 w-3/5 rounded"></div>
                <div class="shimmer h-3 w-1/4 rounded"></div>
              </div>
              <div class="shimmer w-24 h-9 rounded-lg"></div>
            </div>
          }
        </div>
      }

      <!-- - Empty state - -->
      @if (!loading() && (!cart() || cart()!.items.length === 0)) {
        <div class="card p-12 text-center animate-fade-in">
          <svg class="w-12 h-12 text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
          </svg>
          <p class="text-zinc-700 font-medium mb-1">Your cart is empty</p>
          <p class="text-zinc-800 text-sm mb-6">Browse the catalog to add items</p>
          <a routerLink="/catalog" class="btn-primary inline-flex items-center gap-2 py-2.5 px-5 text-sm">
            Browse Catalog
          </a>
        </div>
      }

      <!-- - Cart items - -->
      @if (!loading() && cart() && cart()!.items.length > 0) {

        <!-- Expiry warnings -->
        @if (isCritical()) {
          <div class="mb-4 flex items-start gap-3 px-4 py-3 rounded-xl
                      bg-red-500/10 border border-red-500/30 text-sm text-red-300 animate-scale-in">
            <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.008v.008H12v-.008Z" />
            </svg>
            Under 1 minute left! Place your order now or items will be released.
          </div>
        } @else if (isWarning()) {
          <div class="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl
                      bg-[#c4832a]/10 border border-[#c4832a]/20 text-sm text-[#c4832a]">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Cart expires soon &mdash; less than 5 minutes remaining.
          </div>
        }

        <!-- Items list -->
        <div class="card divide-y divide-zinc-200 p-0 overflow-hidden mb-4">
          @for (item of cart()!.items; track item.id) {
            <div class="flex items-center gap-3 sm:gap-4 p-4 transition-opacity"
                 [class.opacity-40]="deletingItemId() === item.id">

              <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-zinc-800/80 border border-zinc-200 shrink-0
                          flex items-center justify-center">
                <svg class="w-5 h-5 text-zinc-800" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622" />
                </svg>
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-zinc-900 truncate">{{ item.productName }}</p>
                <p class="text-xs text-zinc-700 mt-0.5">{{ '$' + item.price }} each</p>
              </div>

              <!-- Qty stepper -->
              <div class="flex items-center border border-zinc-200 rounded-lg bg-zinc-100">
                <button type="button"
                  (click)="changeQty(item, item.qty - 1)"
                  [disabled]="item.qty <= 1 || updatingItemId() === item.id"
                  class="w-8 h-8 flex items-center justify-center text-zinc-700 hover:text-zinc-900 hover:bg-white/5
                         transition-colors rounded-l-lg disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
                  </svg>
                </button>
                <span class="w-8 text-center text-sm font-semibold text-zinc-900 tabular-nums">
                  @if (updatingItemId() === item.id) {
                    <svg class="w-3.5 h-3.5 animate-spin mx-auto text-zinc-700" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                  } @else {
                    {{ item.qty }}
                  }
                </span>
                <button type="button"
                  (click)="changeQty(item, item.qty + 1)"
                  [disabled]="updatingItemId() === item.id"
                  class="w-8 h-8 flex items-center justify-center text-zinc-700 hover:text-zinc-900 hover:bg-white/5
                         transition-colors rounded-r-lg disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </button>
              </div>

              <span class="text-sm font-semibold text-zinc-800 w-14 text-right tabular-nums hidden sm:block">
                {{ '$' + lineTotal(item) }}
              </span>

              <button type="button"
                (click)="removeItem(item)"
                [disabled]="deletingItemId() === item.id"
                class="w-8 h-8 flex items-center justify-center rounded-lg
                       text-zinc-800 hover:text-red-400 hover:bg-red-500/10
                       transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          }
        </div>

        <!-- Summary + actions -->
        <div class="glass rounded-xl p-5 space-y-4">
          <div class="flex items-end justify-between">
            <div class="text-sm text-zinc-700">
              {{ cart()!.items.length }} item{{ cart()!.items.length === 1 ? '' : 's' }}
            </div>
            <div class="text-right">
              <p class="text-xs text-zinc-700 mb-0.5">Estimated total</p>
              <p class="text-2xl font-bold text-[#c4832a] tabular-nums">{{ '$' + total() }}</p>
            </div>
          </div>

          <p class="text-xs text-zinc-800 leading-relaxed">
            Payment is processed by a store associate after your order is placed.
          </p>

          <div class="flex flex-col sm:flex-row gap-3">
            <a routerLink="/catalog"
               class="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Continue Shopping
            </a>
            <button type="button"
              class="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
              [disabled]="placingOrder() || countdown() === 0"
              (click)="placeOrder()">
              @if (placingOrder()) {
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Placing order...
              } @else {
                Place Order
              }
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class CartComponent implements OnInit, OnDestroy {
  private readonly cartSvc = inject(CartService);
  private readonly toast   = inject(ToastService);
  private readonly router  = inject(Router);

  readonly loading        = signal(true);
  readonly cart           = signal<CartDetail | null>(null);
  readonly countdown      = signal(0);
  readonly placingOrder   = signal(false);
  readonly updatingItemId = signal<string | null>(null);
  readonly deletingItemId = signal<string | null>(null);
  readonly pickupCode     = signal<string | null>(null);
  readonly orderId        = signal<string | null>(null);

  readonly isWarning  = computed(() => this.countdown() > 0 && this.countdown() < 300);
  readonly isCritical = computed(() => this.countdown() > 0 && this.countdown() < 60);

  readonly total = computed(() => {
    const c = this.cart();
    if (!c) return '0.00';
    return c.items.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0).toFixed(2);
  });

  readonly pickupCodeDigits = computed(() => (this.pickupCode() ?? '      ').split(''));

  readonly countdownLabel = computed(() => {
    const s = this.countdown();
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  });

  readonly countdownBadgeClass = computed(() => {
    if (this.isCritical()) return 'bg-red-500/10 border-red-500/25 text-red-300';
    if (this.isWarning())  return 'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]';
    return 'bg-zinc-800/80 border-zinc-700 text-zinc-700';
  });

  private timerRef: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadCart();
  }

  ngOnDestroy(): void { this.clearTimer(); }

  lineTotal(item: CartItem): string {
    return (parseFloat(item.price) * item.qty).toFixed(2);
  }

  print(): void { window.print(); }

  async changeQty(item: CartItem, newQty: number): Promise<void> {
    if (newQty < 1 || this.updatingItemId() === item.id) return;
    this.updatingItemId.set(item.id);
    const ok = await this.cartSvc.updateQty(item.id, newQty);
    if (ok) {
      this.cart.update((c) =>
        c ? { ...c, items: c.items.map((i) => i.id === item.id ? { ...i, qty: newQty } : i) } : c,
      );
    }
    this.updatingItemId.set(null);
  }

  async removeItem(item: CartItem): Promise<void> {
    if (this.deletingItemId() === item.id) return;
    this.deletingItemId.set(item.id);
    const ok = await this.cartSvc.removeItem(item.id);
    if (ok) {
      this.cart.update((c) =>
        c ? { ...c, items: c.items.filter((i) => i.id !== item.id) } : c,
      );
    }
    this.deletingItemId.set(null);
  }

  async placeOrder(): Promise<void> {
    if (this.placingOrder()) return;
    this.placingOrder.set(true);
    this.clearTimer();
    const result = await this.cartSvc.placeOrder();
    this.placingOrder.set(false);
    if (result) {
      this.pickupCode.set(result.pickupCode);
      this.orderId.set(result.id);
      this.cart.set(null);
    }
  }

  private async loadCart(): Promise<void> {
    try {
      const c = await this.cartSvc.getCart();
      this.cart.set(c);
      if (c && c.secondsRemaining > 0) {
        this.countdown.set(c.secondsRemaining);
        this.startTimer();
      }
    } finally {
      this.loading.set(false);
    }
  }

  private startTimer(): void {
    this.timerRef = setInterval(() => {
      this.countdown.update((s) => {
        if (s <= 1) { this.clearTimer(); this.onExpired(); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timerRef) { clearInterval(this.timerRef); this.timerRef = null; }
  }

  private onExpired(): void {
    this.cart.set(null);
    this.toast.warning('Cart expired &mdash; reserved items have been released.');
    void this.router.navigate(['/catalog']);
  }
}
