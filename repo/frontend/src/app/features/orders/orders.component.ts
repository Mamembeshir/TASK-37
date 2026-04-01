import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_BADGE,
  type OrderSummary,
} from '../../core/models/order.model';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 animate-fade-in space-y-6">

      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900 tracking-tight">My Orders</h1>
        <p class="mt-1 text-sm text-zinc-700">
          Review your order history and leave reviews for picked-up orders.
        </p>
      </div>

      <!-- Loading skeletons -->
      @if (loading()) {
        <div class="space-y-3">
          @for (i of [1, 2, 3]; track i) {
            <div class="glass rounded-2xl border border-zinc-200 p-4 flex items-center gap-4 animate-pulse">
              <div class="flex-1 space-y-2">
                <div class="h-3 w-36 bg-zinc-800 rounded"></div>
                <div class="h-2.5 w-24 bg-zinc-100 rounded"></div>
              </div>
              <div class="h-5 w-20 bg-zinc-800 rounded-full"></div>
            </div>
          }
        </div>
      }

      <!-- Error -->
      @if (!loading() && loadError()) {
        <div class="glass rounded-2xl border border-red-500/20 p-6 text-center space-y-2">
          <p class="text-sm text-red-300">{{ loadError() }}</p>
          <button type="button"
            class="text-xs text-zinc-700 hover:text-zinc-800 transition-colors underline"
            (click)="load()">
            Retry
          </button>
        </div>
      }

      <!-- Empty state -->
      @if (!loading() && !loadError() && orders().length === 0) {
        <div class="text-center py-16 space-y-3">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                      bg-zinc-100 border border-zinc-200 mb-2">
            <svg class="w-6 h-6 text-zinc-800" fill="none" stroke="currentColor"
                 stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z" />
            </svg>
          </div>
          <p class="text-sm text-zinc-700">No orders yet.</p>
          <a routerLink="/catalog"
            class="inline-flex items-center gap-1.5 text-xs text-[#c4832a]
                   hover:text-[#c4832a] transition-colors font-medium">
            Browse the catalog
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </div>
      }

      <!-- Orders list -->
      @if (!loading() && orders().length > 0) {
        <div class="space-y-3">
          @for (order of orders(); track order.id) {
            <div class="glass rounded-2xl border border-zinc-200 p-4
                        hover:border-white/12 transition-colors group">
              <div class="flex items-center justify-between gap-4">
                <!-- Left: order info -->
                <div class="min-w-0">
                  <p class="text-sm font-mono text-zinc-700 truncate">
                    {{ order.id.slice(0, 8).toUpperCase() }}…
                    <span class="text-zinc-800 font-sans text-xs ml-1">
                      {{ order.id.slice(8, 18) }}
                    </span>
                  </p>
                  <p class="text-xs text-zinc-800 mt-0.5">
                    Placed {{ formatDate(order.createdAt) }}
                  </p>
                </div>

                <!-- Right: status + actions -->
                <div class="flex items-center gap-3 shrink-0">
                  <span class="badge border text-[10px] px-2 py-0.5
                               {{ statusBadge(order.status) }}">
                    {{ statusLabel(order.status) }}
                  </span>

                  <!-- Reviews link (picked_up orders) -->
                  @if (order.status === 'picked_up') {
                    <a [routerLink]="['/orders', order.id, 'reviews']"
                      class="inline-flex items-center gap-1 text-xs text-[#c4832a]
                             hover:text-[#c4832a] transition-colors font-medium">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                           stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round"
                          d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                      </svg>
                      Reviews
                    </a>
                  }

                  <!-- Checkout link (pending payment, staff-side) -->
                  @if (order.status === 'pending') {
                    <a [routerLink]="['/associate/checkout', order.id]"
                      class="inline-flex items-center gap-1 text-xs text-[#c4832a]
                             hover:text-[#c4832a] transition-colors font-medium">
                      Checkout
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2"
                           viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round"
                          d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                    </a>
                  }
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Pagination -->
        @if (total() > PAGE_SIZE) {
          <div class="flex items-center justify-between pt-2">
            <span class="text-xs text-zinc-800">
              {{ offset() + 1 }}–{{ Math.min(offset() + PAGE_SIZE, total()) }}
              of {{ total() }}
            </span>
            <div class="flex gap-2">
              <button type="button"
                class="px-3 py-1.5 text-xs rounded-lg border border-zinc-200
                       text-zinc-700 hover:text-zinc-800 hover:border-zinc-300
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                [disabled]="offset() === 0"
                (click)="prevPage()">
                Previous
              </button>
              <button type="button"
                class="px-3 py-1.5 text-xs rounded-lg border border-zinc-200
                       text-zinc-700 hover:text-zinc-800 hover:border-zinc-300
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                [disabled]="offset() + PAGE_SIZE >= total()"
                (click)="nextPage()">
                Next
              </button>
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class OrdersComponent implements OnInit {
  private readonly orderSvc = inject(OrderService);

  readonly loading   = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly orders    = signal<OrderSummary[]>([]);
  readonly total     = signal(0);
  readonly offset    = signal(0);

  readonly PAGE_SIZE = PAGE_SIZE;
  readonly Math = Math;

  statusLabel(s: string): string { return ORDER_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string { return ORDER_STATUS_BADGE[s] ?? ''; }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const res = await firstValueFrom(
        this.orderSvc.listOrders(PAGE_SIZE, this.offset()),
      );
      this.orders.set(res.data);
      this.total.set(res.total);
    } catch {
      this.loadError.set('Could not load orders — please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  prevPage(): void { this.offset.update((o) => Math.max(0, o - PAGE_SIZE)); void this.load(); }
  nextPage(): void { this.offset.update((o) => o + PAGE_SIZE); void this.load(); }
}
