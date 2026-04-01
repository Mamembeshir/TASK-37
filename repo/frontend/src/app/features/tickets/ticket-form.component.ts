import { Component, Output, EventEmitter, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { TicketService } from '../../core/services/ticket.service';
import { ToastService } from '../../core/services/toast.service';
import { TICKET_TYPE_LABEL, type Ticket, type TicketType } from '../../core/models/ticket.model';

const TICKET_TYPES: TicketType[] = ['return', 'refund', 'price_adjustment'];

@Component({
  selector: 'app-ticket-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="glass rounded-2xl border border-zinc-200 p-6 space-y-5 animate-scale-in">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
            <svg class="w-4.5 h-4.5 text-sky-700" fill="none" stroke="currentColor"
                 stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a3 3 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
            </svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-zinc-900">Open a Support Ticket</h3>
            <p class="text-xs text-zinc-700">Returns, refunds, and price adjustments</p>
          </div>
        </div>
        <button type="button"
          class="p-1.5 rounded-lg text-zinc-800 hover:text-zinc-700 hover:bg-white/5 transition-colors"
          (click)="cancelled.emit()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
               viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Type selector -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-zinc-700">Ticket type</label>
        <div class="grid grid-cols-3 gap-2">
          @for (t of ticketTypes; track t) {
            <button type="button"
              class="px-3 py-2.5 rounded-xl text-xs font-medium border transition-all duration-150"
              [class]="selectedType === t
                ? 'border-[#c4832a]/30 bg-[#c4832a]/10 text-[#c4832a]'
                : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:text-zinc-700 hover:border-zinc-300'"
              (click)="selectedType = t">
              {{ typeLabel(t) }}
            </button>
          }
        </div>
      </div>

      <!-- Order ID -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-zinc-700">Order ID</label>
        <input
          type="text"
          class="input-field font-mono text-sm"
          placeholder="Paste your order UUID…"
          [(ngModel)]="orderId"
          (input)="apiError.set(null)"
        />
      </div>

      <!-- Receipt reference (price_adjustment only) -->
      @if (selectedType === 'price_adjustment') {
        <div class="space-y-1.5 animate-scale-in">
          <label class="text-xs font-medium text-zinc-700">
            Receipt reference
            <span class="text-red-400 ml-0.5">*</span>
          </label>
          <input
            type="text"
            class="input-field text-sm"
            placeholder="Enter receipt or transaction reference…"
            [(ngModel)]="receiptReference"
            (input)="apiError.set(null)"
          />
          <p class="text-[10px] text-zinc-800">
            Required for price adjustments · Cap of $50.00 per order applies
          </p>
        </div>
      }

      <!-- Eligibility note -->
      @if (selectedType === 'return' || selectedType === 'refund') {
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg
                    bg-zinc-800/40 border border-zinc-200 text-xs text-zinc-700">
          <svg class="w-3.5 h-3.5 shrink-0 text-zinc-800" fill="none" stroke="currentColor"
               stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Eligible within 30 days of order creation.
        </div>
      }

      <!-- API error -->
      @if (apiError()) {
        <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg
                    bg-red-500/10 border border-red-500/25 text-xs text-red-300 animate-scale-in">
          <svg class="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" stroke="currentColor"
               stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          {{ apiError() }}
        </div>
      }

      <!-- Submit -->
      <div class="flex gap-3 pt-1">
        <button type="button"
          class="flex-1 btn-primary py-2.5 text-sm flex items-center justify-center gap-2
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          [disabled]="!canSubmit() || submitting()"
          (click)="submit()">
          @if (submitting()) {
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            Opening ticket…
          } @else {
            Open Ticket
          }
        </button>
        <button type="button"
          class="px-4 py-2.5 text-sm rounded-xl border border-zinc-200 text-zinc-700
                 hover:text-zinc-700 hover:border-zinc-300 transition-colors"
          (click)="cancelled.emit()">
          Cancel
        </button>
      </div>
    </div>
  `,
})
export class TicketFormComponent {
  @Output() submitted = new EventEmitter<Ticket>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly ticketSvc = inject(TicketService);
  private readonly toast      = inject(ToastService);

  readonly submitting = signal(false);
  readonly apiError   = signal<string | null>(null);

  readonly ticketTypes = TICKET_TYPES;
  selectedType: TicketType = 'return';
  orderId = '';
  receiptReference = '';

  typeLabel(t: TicketType): string { return TICKET_TYPE_LABEL[t]; }

  readonly canSubmit = computed(() => {
    if (!this.orderId.trim()) return false;
    if (this.selectedType === 'price_adjustment' && !this.receiptReference.trim()) return false;
    return true;
  });

  async submit(): Promise<void> {
    if (!this.canSubmit() || this.submitting()) return;
    this.submitting.set(true);
    this.apiError.set(null);

    try {
      const ticket = await firstValueFrom(
        this.ticketSvc.create({
          orderId: this.orderId.trim(),
          type: this.selectedType,
          ...(this.selectedType === 'price_adjustment'
            ? { receiptReference: this.receiptReference.trim() }
            : {}),
        }),
      );
      this.toast.success('Ticket opened — our team will be in touch.');
      this.orderId = '';
      this.receiptReference = '';
      this.submitted.emit(ticket);
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      this.apiError.set(
        (e.error as { error?: string })?.error ?? 'Could not open ticket — please try again.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
