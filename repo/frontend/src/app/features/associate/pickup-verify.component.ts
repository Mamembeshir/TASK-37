import {
  Component,
  OnInit,
  AfterViewInit,
  inject,
  signal,
  computed,
  ViewChildren,
  QueryList,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { OrderService } from '../../core/services/order.service';
import { ToastService } from '../../core/services/toast.service';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE } from '../../core/models/order.model';
import type { OrderDetail } from '../../core/models/order.model';

type Step = 'lookup' | 'verify' | 'locked' | 'success';

const MAX_ATTEMPTS = 5;

@Component({
  selector: 'app-pickup-verify',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="mx-auto max-w-xl px-4 sm:px-6 py-8 animate-fade-in">

      <!-- Breadcrumb -->
      <div class="flex items-center gap-1.5 text-xs text-zinc-700 mb-6">
        <a routerLink="/associate" class="hover:text-zinc-700 transition-colors">Associate</a>
        <span class="text-zinc-700">/</span>
        <span>Pickup Verification</span>
      </div>

      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                    bg-[#c4832a]/10 border border-[#c4832a]/20 mb-4">
          <svg class="w-7 h-7 text-[#c4832a]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-zinc-900">Pickup Verification</h1>
        <p class="text-zinc-700 text-sm mt-1">Verify a customer's 6-digit pickup code</p>
      </div>

      <!-- - Step 1: Lookup - -->
      @if (step() === 'lookup') {
        <div class="glass rounded-2xl p-6 space-y-4 animate-scale-in">
          <label class="block text-xs font-medium text-zinc-700">Order ID</label>
          <input
            type="text"
            class="input-field font-mono text-sm"
            placeholder="Paste or enter order UUID..."
            [(ngModel)]="orderIdInput"
            (keydown.enter)="lookupOrder()"
          />
          <button type="button"
            class="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            [disabled]="looking()"
            (click)="lookupOrder()">
            @if (looking()) {
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              Looking up...
            } @else {
              Find Order
            }
          </button>
          @if (lookupError()) {
            <p class="text-xs text-red-400 text-center">{{ lookupError() }}</p>
          }
        </div>
      }

      <!-- Order info card (shown in verify/locked steps) -->
      @if (order() && step() !== 'lookup' && step() !== 'success') {
        <div class="glass rounded-xl px-4 py-3 flex items-center justify-between mb-4">
          <div>
            <p class="text-xs text-zinc-700 font-mono">{{ order()!.id.slice(0, 18) }}...</p>
            <p class="text-xs text-zinc-700 mt-0.5">
              {{ order()!.createdAt.substring(0, 10) }}
            </p>
          </div>
          <span class="badge border text-[10px] px-2 py-0.5 {{ statusBadge(order()!.status) }}">
            {{ statusLabel(order()!.status) }}
          </span>
        </div>
      }

      <!-- - Step 2: Verify code - -->
      @if (step() === 'verify') {
        <div class="glass rounded-2xl p-6 space-y-6 animate-scale-in">

          <!-- Attempt indicator -->
          <div class="flex items-center justify-between">
            <div class="flex gap-1.5">
              @for (i of attemptsArray; track i) {
                <div class="w-7 h-2 rounded-full transition-colors"
                     [class]="i < localAttempts() ? 'bg-red-500' : 'bg-zinc-700'">
                </div>
              }
            </div>
            <span class="text-xs text-zinc-700">
              {{ remainingAttempts() }} attempt{{ remainingAttempts() === 1 ? '' : 's' }} remaining
            </span>
          </div>

          <!-- Wrong code warning -->
          @if (wrongCode()) {
            <div class="flex items-center gap-2 px-3 py-2.5 rounded-lg
                        bg-red-500/10 border border-red-500/25 text-sm text-red-300 animate-scale-in">
              <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Incorrect code &mdash; {{ remainingAttempts() }} attempt{{ remainingAttempts() === 1 ? '' : 's' }} left
            </div>
          }

          <!-- 6-digit input -->
          <div>
            <label class="block text-xs font-medium text-zinc-700 mb-3 text-center">
              Enter customer's 6-digit code
            </label>
            <div class="flex items-center justify-center gap-2 sm:gap-3">
              @for (i of [0,1,2,3,4,5]; track i) {
                <input #digitInput
                  type="text"
                  inputmode="numeric"
                  maxlength="1"
                  autocomplete="off"
                  class="w-12 h-14 sm:w-13 sm:h-15 text-center text-2xl font-bold font-mono
                         bg-zinc-900 border-2 rounded-xl text-zinc-900 outline-none
                         transition-colors
                         focus:border-[#c4832a] focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
                  [class]="wrongCode() ? 'border-red-500/60' : 'border-zinc-700'"
                  [value]="codeDigits[i]"
                  (input)="onDigitInput($event, i)"
                  (keydown)="onDigitKeydown($event, i)"
                  (paste)="onCodePaste($event)"
                />
              }
            </div>
          </div>

          <button type="button"
            class="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            [disabled]="fullCode.length < 6 || verifying()"
            (click)="verifyCode()">
            @if (verifying()) {
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              Verifying...
            } @else {
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Verify Code
            }
          </button>
        </div>
      }

      <!-- - Step 3: Locked &mdash; manager override - -->
      @if (step() === 'locked') {
        <div class="glass rounded-2xl p-6 space-y-5 animate-scale-in">

          <!-- Lockout banner -->
          <div class="flex items-start gap-3 px-4 py-3 rounded-xl
                      bg-red-500/10 border border-red-500/25">
            <svg class="w-6 h-6 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <div>
              <p class="text-sm font-semibold text-red-300">Order Locked</p>
              <p class="text-xs text-red-400/80 mt-0.5">
                Maximum {{ MAX_ATTEMPTS }} attempts reached. A manager must authorise this pickup.
              </p>
            </div>
          </div>

          <h2 class="text-sm font-semibold text-zinc-700">Manager Override</h2>

          @if (overrideError()) {
            <div class="flex items-center gap-2 px-3 py-2 rounded-lg
                        bg-red-500/10 border border-red-500/25 text-sm text-red-300">
              <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              {{ overrideError() }}
            </div>
          }

          <div class="space-y-3">
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Manager username</label>
              <input type="text" class="input-field py-2.5 text-sm" autocomplete="off"
                     placeholder="Enter manager username"
                     [(ngModel)]="managerUsername" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Manager password</label>
              <input type="password" class="input-field py-2.5 text-sm" autocomplete="off"
                     placeholder="Enter manager password"
                     [(ngModel)]="managerPassword" />
            </div>
          </div>

          <button type="button"
            class="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            [disabled]="overriding() || !managerUsername || !managerPassword"
            (click)="submitOverride()">
            @if (overriding()) {
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
              Verifying credentials...
            } @else {
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              Authorize Override
            }
          </button>
        </div>
      }

      <!-- - Step 4: Success - -->
      @if (step() === 'success') {
        <div class="space-y-4 animate-scale-in">

          <!-- Hero card -->
          <div class="glass rounded-2xl p-8 text-center space-y-5
                      border border-[#c4832a]/20
                      shadow-[0_0_40px_rgba(245,158,11,0.08)]">

            <!-- Animated checkmark with glow rings -->
            <div class="relative inline-flex items-center justify-center mx-auto">
              <!-- Outer glow ring -->
              <div class="absolute w-28 h-28 rounded-full bg-amber-500/8
                          border border-amber-500/15 animate-pulse"></div>
              <!-- Inner ring -->
              <div class="absolute w-20 h-20 rounded-full bg-amber-500/12
                          border border-[#c4832a]/20"></div>
              <!-- Icon circle -->
              <div class="relative w-16 h-16 rounded-full bg-[#c4832a]/10
                          border-2 border-amber-500/50 flex items-center justify-center
                          shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                <svg class="w-8 h-8 text-[#c4832a]" fill="none" stroke="currentColor"
                     stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
            </div>

            <!-- Title + method badge -->
            <div class="space-y-2">
              <h2 class="text-3xl font-bold text-zinc-900 tracking-tight">Pickup Confirmed</h2>
              <div class="flex items-center justify-center gap-2">
                @if (wasOverride()) {
                  <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs
                               font-semibold bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                    Manager Override
                  </span>
                } @else {
                  <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs
                               font-semibold bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
                    </svg>
                    Code Verified
                  </span>
                }
              </div>
              <p class="text-sm text-zinc-700">
                Order marked as picked up and customer record updated.
              </p>
            </div>

            <!-- Timestamp -->
            <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full
                        bg-zinc-100 border border-zinc-200">
              <svg class="w-3.5 h-3.5 text-zinc-700 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span class="text-xs font-medium text-zinc-700">{{ verifiedAt() }}</span>
            </div>
          </div>

          <!-- Order summary card -->
          @if (order()) {
            <div class="glass rounded-xl border border-zinc-200 divide-y divide-zinc-200">
              <!-- Header -->
              <div class="px-4 py-3 flex items-center justify-between">
                <span class="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                  Order Summary
                </span>
                <span class="text-[10px] font-mono text-zinc-800 select-all">
                  {{ order()!.id.slice(0, 8).toUpperCase() }}...
                </span>
              </div>

              <!-- Item count + total row -->
              <div class="px-4 py-3 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor"
                       stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z" />
                  </svg>
                  <span class="text-sm text-zinc-700">
                    {{ activeItemCount() }} item{{ activeItemCount() === 1 ? '' : 's' }}
                  </span>
                </div>
                <span class="text-sm font-semibold text-zinc-900">
                  {{ '$' + orderTotal() }}
                </span>
              </div>

              <!-- Items list -->
              @for (item of activeItems(); track item.id) {
                <div class="px-4 py-2.5 flex items-center justify-between">
                  <span class="text-xs text-zinc-700 truncate flex-1 pr-4">
                    {{ item.productName }}
                  </span>
                  <span class="text-xs text-zinc-700 shrink-0">x{{ item.qty }}</span>
                </div>
              }

              <!-- Pickup groups -->
              @if (order()!.pickupGroups.length > 0) {
                <div class="px-4 py-3 flex items-start gap-2">
                  <svg class="w-3.5 h-3.5 text-zinc-800 mt-0.5 shrink-0" fill="none"
                       stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M2.25 21h19.5m-18-18v18m2.25-18v18M6.75 6.75h.008v.008H6.75V6.75Zm0 3h.008v.008H6.75V9.75Zm0 3h.008v.008H6.75v-.008Zm3-6h.008v.008H9.75V6.75Zm0 3h.008v.008H9.75V9.75Zm0 3h.008v.008H9.75v-.008Zm3-6h.008v.008h-.008V6.75Zm0 3h.008v.008h-.008V9.75Zm0 3h.008v.008h-.008v-.008Z" />
                  </svg>
                  <div class="flex flex-wrap gap-1.5">
                    @for (g of order()!.pickupGroups; track g.id) {
                      <span class="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800
                                   border border-zinc-200 text-zinc-700 uppercase tracking-wide">
                        {{ g.department }}
                      </span>
                    }
                  </div>
                </div>
              }
            </div>
          }

          <!-- CTA buttons -->
          <div class="flex gap-3">
            <button type="button"
              class="flex-1 btn-primary py-3 text-sm flex items-center justify-center gap-2"
              (click)="reset()">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                   viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Verify Another
            </button>
            <button type="button"
              class="px-4 py-3 text-sm rounded-xl border border-zinc-200 text-zinc-700
                     hover:text-zinc-800 hover:border-zinc-300 transition-colors
                     flex items-center gap-2"
              (click)="printConfirmation()">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5"
                   viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
              </svg>
              Print
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class PickupVerifyComponent implements OnInit, AfterViewInit {
  @ViewChildren('digitInput') digitInputs!: QueryList<ElementRef<HTMLInputElement>>;

  private readonly route    = inject(ActivatedRoute);
  private readonly orderSvc = inject(OrderService);
  private readonly toast    = inject(ToastService);

  readonly step          = signal<Step>('lookup');
  readonly order         = signal<OrderDetail | null>(null);
  readonly looking       = signal(false);
  readonly lookupError   = signal<string | null>(null);
  readonly verifying     = signal(false);
  readonly localAttempts = signal(0);
  readonly wrongCode     = signal(false);
  readonly overriding    = signal(false);
  readonly overrideError = signal<string | null>(null);
  readonly wasOverride   = signal(false);
  readonly verifiedAt    = signal('');

  readonly MAX_ATTEMPTS = MAX_ATTEMPTS;
  readonly attemptsArray = Array.from({ length: MAX_ATTEMPTS }, (_, i) => i);
  readonly remainingAttempts = computed(() => MAX_ATTEMPTS - this.localAttempts());
  readonly activeItems = computed(() =>
    this.order()?.items.filter((i) => !i.cancelledAt) ?? [],
  );
  readonly activeItemCount = computed(() => this.activeItems().length);

  orderIdInput  = '';
  managerUsername = '';
  managerPassword = '';
  codeDigits: string[] = Array(6).fill('');

  get fullCode(): string { return this.codeDigits.join(''); }

  statusLabel(s: string): string { return ORDER_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string { return ORDER_STATUS_BADGE[s] ?? ''; }

  orderTotal(): string {
    const splits = this.order()?.tenderSplits ?? [];
    return splits.reduce((s, t) => s + Number(t.amount), 0).toFixed(2);
  }

  ngOnInit(): void {
    // Pre-fill order ID from query param (e.g. from order list link)
    const id = this.route.snapshot.queryParamMap.get('orderId');
    if (id) { this.orderIdInput = id; }
  }

  ngAfterViewInit(): void {}

  // -- Step 1: Lookup --------------------------------------------------------

  async lookupOrder(): Promise<void> {
    const id = this.orderIdInput.trim();
    if (!id) return;
    this.looking.set(true);
    this.lookupError.set(null);

    try {
      const o = await firstValueFrom(this.orderSvc.getOrder(id));
      this.order.set(o);

      if (o.status === 'pickup_locked') {
        this.step.set('locked');
      } else if (o.status === 'ready_for_pickup') {
        this.step.set('verify');
        setTimeout(() => this.digitInputs.first?.nativeElement.focus(), 50);
      } else {
        this.lookupError.set(
          `Order status is "${this.statusLabel(o.status)}" &mdash; only ready_for_pickup orders can be verified.`,
        );
      }
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      this.lookupError.set(
        e.status === 404 ? 'Order not found.' : 'Could not load order.',
      );
    } finally {
      this.looking.set(false);
    }
  }

  // -- 6-digit input handlers ------------------------------------------------

  onDigitInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, '').slice(-1);
    this.codeDigits[index] = val;
    input.value = val;
    this.wrongCode.set(false);
    if (val && index < 5) {
      this.digitInputs.get(index + 1)?.nativeElement.focus();
    }
  }

  onDigitKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace' && !this.codeDigits[index] && index > 0) {
      this.codeDigits[index - 1] = '';
      this.digitInputs.get(index - 1)?.nativeElement.focus();
    }
    if (event.key === 'Enter' && this.fullCode.length === 6) {
      void this.verifyCode();
    }
  }

  onCodePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const digits = text.replace(/\D/g, '').slice(0, 6).split('');
    digits.forEach((d, i) => { this.codeDigits[i] = d; });
    const next = this.codeDigits.findIndex((d) => !d);
    this.digitInputs.get(next === -1 ? 5 : next)?.nativeElement.focus();
  }

  private clearDigits(): void {
    this.codeDigits = Array(6).fill('');
    setTimeout(() => {
      this.digitInputs.first?.nativeElement.focus();
      this.digitInputs.forEach((el) => { el.nativeElement.value = ''; });
    }, 50);
  }

  // -- Step 2: Verify --------------------------------------------------------

  async verifyCode(): Promise<void> {
    if (this.fullCode.length < 6 || this.verifying()) return;
    this.verifying.set(true);
    this.wrongCode.set(false);

    try {
      const res = await firstValueFrom(
        this.orderSvc.verifyPickupCode(this.order()!.id, this.fullCode),
      );
      if (res.verified) {
        this.wasOverride.set(false);
        this.verifiedAt.set(new Date().toLocaleString(undefined, {
          dateStyle: 'medium', timeStyle: 'medium',
        }));
        this.step.set('success');
      } else {
        this.localAttempts.update((n) => n + 1);
        this.wrongCode.set(true);
        this.clearDigits();
        if (this.localAttempts() >= MAX_ATTEMPTS) {
          this.step.set('locked');
        }
      }
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status === 423) {
        this.step.set('locked');
      } else if (e.status === 409) {
        this.lookupError.set((e.error as { error?: string })?.error ?? 'Order not in ready state');
        this.step.set('lookup');
      } else {
        this.toast.error('Verification failed &mdash; please try again');
      }
    } finally {
      this.verifying.set(false);
    }
  }

  // -- Step 3: Manager override ----------------------------------------------

  async submitOverride(): Promise<void> {
    if (!this.managerUsername || !this.managerPassword || this.overriding()) return;
    this.overriding.set(true);
    this.overrideError.set(null);

    try {
      await firstValueFrom(
        this.orderSvc.managerOverride(this.order()!.id, this.managerUsername, this.managerPassword),
      );
      this.wasOverride.set(true);
      this.verifiedAt.set(new Date().toLocaleString(undefined, {
          dateStyle: 'medium', timeStyle: 'medium',
        }));
      this.step.set('success');
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status === 401 || e.status === 403) {
        this.overrideError.set('Invalid manager credentials or insufficient role.');
      } else if (e.status === 423) {
        this.overrideError.set('Manager account is locked. Try another manager.');
      } else {
        this.overrideError.set('Override failed &mdash; please try again.');
      }
    } finally {
      this.overriding.set(false);
    }
  }

  // -- Print confirmation ----------------------------------------------------

  printConfirmation(): void {
    window.print();
  }

  // -- Reset -----------------------------------------------------------------

  reset(): void {
    this.step.set('lookup');
    this.order.set(null);
    this.orderIdInput = '';
    this.codeDigits = Array(6).fill('');
    this.localAttempts.set(0);
    this.wrongCode.set(false);
    this.lookupError.set(null);
    this.overrideError.set(null);
    this.managerUsername = '';
    this.managerPassword = '';
  }
}
