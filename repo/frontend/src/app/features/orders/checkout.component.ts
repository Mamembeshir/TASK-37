import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { OrderService } from '../../core/services/order.service';
import { ToastService } from '../../core/services/toast.service';
import { PickupGroupEditorComponent } from './pickup-group-editor.component';
import type { OrderDetail, TenderSplit } from '../../core/models/order.model';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE } from '../../core/models/order.model';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [RouterLink, FormsModule, PickupGroupEditorComponent],
  template: `
    <div class="mx-auto max-w-3xl px-4 sm:px-6 py-8 animate-fade-in space-y-6">

      <!-- Header -->
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <a routerLink="/associate"
               class="text-xs text-zinc-700 hover:text-zinc-700 transition-colors flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Associate
            </a>
            <span class="text-zinc-700">/</span>
            <span class="text-xs text-zinc-700">Process Payment</span>
          </div>
          <h1 class="text-2xl font-bold text-zinc-900">Process Payment</h1>
          @if (order()) {
            <p class="text-xs font-mono text-zinc-700 mt-1">{{ order()!.id }}</p>
          }
        </div>

        @if (order()) {
          <span class="badge border text-xs px-2.5 py-1 {{ statusBadge(order()!.status) }}">
            {{ statusLabel(order()!.status) }}
          </span>
        }
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-4">
          <div class="card p-5 space-y-3">
            @for (_ of [1,2,3]; track $index) {
              <div class="shimmer h-5 rounded {{ $index === 0 ? 'w-1/2' : $index === 1 ? 'w-3/4' : 'w-1/3' }}"></div>
            }
          </div>
        </div>
      }

      @if (!loading() && order()) {

        <!-- - Order items - -->
        <div class="card p-0 overflow-hidden">
          <div class="px-5 py-3 border-b border-zinc-200 bg-zinc-50">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-700">Order Items</h2>
          </div>
          <div class="divide-y divide-zinc-200">
            @for (item of activeItems(); track item.id) {
              <div class="flex items-center justify-between px-5 py-3">
                <div>
                  <p class="text-sm font-medium text-zinc-800">{{ item.productName }}</p>
                  <p class="text-xs text-zinc-700 mt-0.5">{{ item.qty }} x {{ '$' + item.unitPrice }}</p>
                </div>
                <span class="text-sm font-semibold text-zinc-800 tabular-nums">
                  {{ '$' + lineTotal(item.qty, item.unitPrice) }}
                </span>
              </div>
            }
          </div>
          <div class="flex items-center justify-between px-5 py-3 border-t border-zinc-200 bg-zinc-50">
            <span class="text-sm font-semibold text-zinc-700">Order Total</span>
            <span class="text-lg font-bold text-zinc-900 tabular-nums">{{ '$' + orderTotal() }}</span>
          </div>
        </div>

        <!-- - Tender splits - -->
        <div class="card p-0 overflow-hidden">
          <div class="px-5 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-700">Payments Recorded</h2>
            @if (order()!.tenderSplits.length > 0) {
              <span class="text-xs text-zinc-700">{{ order()!.tenderSplits.length }} split{{ order()!.tenderSplits.length === 1 ? '' : 's' }}</span>
            }
          </div>

          @if (order()!.tenderSplits.length === 0) {
            <p class="px-5 py-4 text-sm text-zinc-800">No payments recorded yet.</p>
          }

          @for (split of order()!.tenderSplits; track split.id) {
            <div class="flex items-center gap-4 px-5 py-3 border-b border-zinc-200 last:border-b-0">
              <span class="w-16 px-2 py-0.5 rounded-md text-center text-xs font-semibold uppercase border
                           {{ split.method === 'cash'
                              ? 'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]'
                              : 'bg-sky-50 border-sky-200 text-sky-700' }}">
                {{ split.method }}
              </span>
              <div class="flex-1">
                @if (split.reference) {
                  <p class="text-xs text-zinc-700 font-mono">Ref: {{ split.reference }}</p>
                }
              </div>
              <span class="text-sm font-semibold text-zinc-800 tabular-nums">{{ '$' + split.amount }}</span>
            </div>
          }

          <!-- Tender total + balance -->
          <div class="px-5 py-3 bg-zinc-50 border-t border-zinc-200 space-y-1">
            <div class="flex items-center justify-between text-sm">
              <span class="text-zinc-700">Tender total</span>
              <span class="font-semibold text-zinc-800 tabular-nums">{{ '$' + tenderTotal() }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-zinc-700">Balance remaining</span>
              <span class="font-bold tabular-nums {{ balanceCents() === 0 ? 'text-[#c4832a]' : balanceCents() < 0 ? 'text-[#c4832a]' : 'text-red-400' }}">
                {{ balanceCents() === 0 ? 'OK Balanced' : '$' + Math.abs(balance()).toFixed(2) + (balanceCents() < 0 ? ' over' : ' due') }}
              </span>
            </div>
          </div>
        </div>

        <!-- - Add tender form - -->
        @if (order()!.status === 'pending') {
          <div class="card p-5 space-y-4">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-700">Add Payment</h2>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <!-- Method -->
              <div class="flex flex-col gap-1">
                <label class="text-xs text-zinc-700">Method</label>
                <select class="input-field py-2 text-sm cursor-pointer" [(ngModel)]="tender.method"
                        (ngModelChange)="onMethodChange()">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </div>

              <!-- Amount -->
              <div class="flex flex-col gap-1">
                <label class="text-xs text-zinc-700">Amount ($)</label>
                <input type="number" class="input-field py-2 text-sm" placeholder="0.00"
                       min="0.01" step="0.01" [(ngModel)]="tender.amount" />
              </div>

              <!-- Reference (card only) -->
              <div class="flex flex-col gap-1 col-span-2 sm:col-span-1">
                <label class="text-xs text-zinc-700">
                  Card reference {{ tender.method === 'card' ? '*' : '' }}
                </label>
                <input type="text" class="input-field py-2 text-sm"
                       placeholder="{{ tender.method === 'card' ? 'Terminal receipt ref.' : 'N/A for cash' }}"
                       [disabled]="tender.method === 'cash'"
                       [(ngModel)]="tender.reference" />
              </div>
            </div>

            <button type="button"
              class="btn-primary py-2 px-4 text-sm flex items-center gap-2
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
              [disabled]="addingTender()"
              (click)="addTender()">
              @if (addingTender()) {
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Recording...
              } @else {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Tender
              }
            </button>
          </div>
        }

        <!-- - Confirm order - -->
        @if (order()!.status === 'pending') {
          <button type="button"
            class="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2
                   disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            [disabled]="balanceCents() !== 0 || confirming()"
            (click)="confirmOrder()">
            @if (confirming()) {
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              Confirming payment...
            } @else if (balanceCents() !== 0) {
              Record full payment before confirming ({{ '$' + Math.abs(balance()).toFixed(2) }}
              {{ balanceCents() > 0 ? 'due' : 'over' }})
            } @else {
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Confirm Order Payment
            }
          </button>
        }

        <!-- - Pickup group editor - -->
        <div class="card p-5">
          <app-pickup-group-editor [order]="order()!" (changed)="reloadOrder()" />
        </div>

      }
    </div>
  `,
})
export class CheckoutComponent implements OnInit {
  private readonly route    = inject(ActivatedRoute);
  private readonly orderSvc = inject(OrderService);
  private readonly toast    = inject(ToastService);

  readonly loading    = signal(true);
  readonly order      = signal<OrderDetail | null>(null);
  readonly error      = signal<string | null>(null);
  readonly addingTender = signal(false);
  readonly confirming   = signal(false);
  readonly tenderError  = signal<string | null>(null);

  protected readonly Math = Math;

  tender: { method: 'cash' | 'card'; amount: string; reference: string } = {
    method: 'cash', amount: '', reference: '',
  };

  // -- Derived ---------------------------------------------------------------

  readonly activeItems = computed(() =>
    this.order()?.items.filter((i) => !i.cancelledAt) ?? [],
  );

  readonly orderTotal = computed(() =>
    this.activeItems()
      .reduce((s, i) => s + parseFloat(i.unitPrice) * i.qty, 0)
      .toFixed(2),
  );

  readonly tenderTotal = computed(() =>
    (this.order()?.tenderSplits ?? [])
      .reduce((s, t) => s + parseFloat(t.amount), 0)
      .toFixed(2),
  );

  // Integer cents to avoid float drift
  readonly orderTotalCents  = computed(() => Math.round(parseFloat(this.orderTotal()) * 100));
  readonly tenderTotalCents = computed(() => Math.round(parseFloat(this.tenderTotal()) * 100));
  readonly balanceCents     = computed(() => this.orderTotalCents() - this.tenderTotalCents());
  readonly balance          = computed(() => this.balanceCents() / 100);

  statusLabel(s: string): string { return ORDER_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string { return ORDER_STATUS_BADGE[s] ?? 'bg-zinc-700 border-zinc-600 text-zinc-700'; }
  lineTotal(qty: number, price: string): string {
    return (qty * parseFloat(price)).toFixed(2);
  }

  // -- Lifecycle -------------------------------------------------------------

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.toast.error('Missing order ID.'); this.loading.set(false); return; }
    await this.loadOrder(id);
  }

  async reloadOrder(): Promise<void> {
    const id = this.order()?.id;
    if (id) await this.loadOrder(id);
  }

  // -- Actions ---------------------------------------------------------------

  onMethodChange(): void {
    if (this.tender.method === 'cash') this.tender.reference = '';
  }

  async addTender(): Promise<void> {
    this.tenderError.set(null);
    const amt = parseFloat(this.tender.amount);
    if (isNaN(amt) || amt <= 0) {
      this.toast.warning('Enter a valid amount greater than zero.');
      return;
    }
    if (this.tender.method === 'card' && !this.tender.reference.trim()) {
      this.toast.warning('Card reference is required for card tender.');
      return;
    }

    this.addingTender.set(true);
    try {
      const split = await firstValueFrom(
        this.orderSvc.addTender(this.order()!.id, {
          method: this.tender.method,
          amount: amt.toFixed(2),
          reference: this.tender.method === 'card' ? this.tender.reference.trim() : null,
        }),
      );
      // Append to local splits without full reload
      this.order.update((o) => {
        if (!o) return o;
        const newSplit: TenderSplit = {
          id: split.id,
          method: split.method,
          amount: split.amount,
          reference: split.reference,
          createdAt: split.createdAt,
        };
        return { ...o, tenderSplits: [...o.tenderSplits, newSplit] };
      });
      this.tender = { method: 'cash', amount: '', reference: '' };
      this.toast.success('Payment recorded');
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg: string = (e.error as { error?: string })?.error ?? 'Could not record payment';
      this.toast.error(msg);
    } finally {
      this.addingTender.set(false);
    }
  }

  async confirmOrder(): Promise<void> {
    if (this.balanceCents() !== 0 || this.confirming()) return;
    this.confirming.set(true);
    try {
      await firstValueFrom(this.orderSvc.confirmOrder(this.order()!.id));
      this.toast.success('Order confirmed &mdash; payment complete');
      await this.reloadOrder();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg: string = (e.error as { error?: string })?.error ?? 'Could not confirm order';
      this.toast.error(msg);
    } finally {
      this.confirming.set(false);
    }
  }

  // -- Data loading ----------------------------------------------------------

  private async loadOrder(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const o = await firstValueFrom(this.orderSvc.getOrder(id));
      this.order.set(o);
    } catch {
      this.toast.error('Order not found or access denied.');
    } finally {
      this.loading.set(false);
    }
  }
}
