import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TicketService } from '../../core/services/ticket.service';
import { TicketFormComponent } from './ticket-form.component';
import { TicketListComponent } from './ticket-list.component';
import type { Ticket } from '../../core/models/ticket.model';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [TicketFormComponent, TicketListComponent],
  template: `
    <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8 animate-fade-in space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900 tracking-tight">Support Tickets</h1>
          <p class="mt-1 text-sm text-zinc-700">
            Open and track return, refund, and price adjustment requests.
          </p>
        </div>
        @if (!showForm()) {
          <button type="button"
            class="btn-primary py-2 px-4 text-sm flex items-center gap-1.5 shrink-0"
            (click)="showForm.set(true)">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Ticket
          </button>
        }
      </div>

      <!-- Inline create form -->
      @if (showForm()) {
        <app-ticket-form
          (submitted)="onTicketCreated($event)"
          (cancelled)="showForm.set(false)"
        />
      }

      <!-- Loading skeletons -->
      @if (loading()) {
        <div class="space-y-3">
          @for (i of [1, 2, 3]; track i) {
            <div class="glass rounded-2xl border border-zinc-200 p-4 animate-pulse space-y-2">
              <div class="flex items-center gap-2">
                <div class="h-3 w-20 bg-zinc-800 rounded"></div>
                <div class="h-5 w-16 bg-zinc-100 rounded-full"></div>
              </div>
              <div class="h-2.5 w-32 bg-zinc-800/40 rounded"></div>
            </div>
          }
        </div>
      }

      <!-- Error -->
      @if (!loading() && loadError()) {
        <div class="glass rounded-2xl border border-red-500/20 p-5 text-center space-y-2">
          <p class="text-sm text-red-300">{{ loadError() }}</p>
          <button type="button"
            class="text-xs text-zinc-700 hover:text-zinc-800 transition-colors underline"
            (click)="load()">
            Retry
          </button>
        </div>
      }

      <!-- Ticket list -->
      @if (!loading() && !loadError()) {
        <app-ticket-list [tickets]="tickets()" />

        <!-- Pagination -->
        @if (total() > PAGE_SIZE) {
          <div class="flex items-center justify-between pt-1">
            <span class="text-xs text-zinc-800">
              {{ offset() + 1 }}–{{ Math.min(offset() + PAGE_SIZE, total()) }}
              of {{ total() }}
            </span>
            <div class="flex gap-2">
              <button type="button"
                class="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 text-zinc-700
                       hover:text-zinc-800 hover:border-zinc-300 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
                [disabled]="offset() === 0"
                (click)="prevPage()">
                Previous
              </button>
              <button type="button"
                class="px-3 py-1.5 text-xs rounded-lg border border-zinc-200 text-zinc-700
                       hover:text-zinc-800 hover:border-zinc-300 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
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
export class TicketsComponent implements OnInit {
  private readonly ticketSvc = inject(TicketService);

  readonly loading   = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly tickets   = signal<Ticket[]>([]);
  readonly total     = signal(0);
  readonly offset    = signal(0);
  readonly showForm  = signal(false);

  readonly PAGE_SIZE = PAGE_SIZE;
  readonly Math = Math;

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const res = await firstValueFrom(
        this.ticketSvc.list(PAGE_SIZE, this.offset()),
      );
      this.tickets.set(res.data);
      this.total.set(res.total);
    } catch {
      this.loadError.set('Could not load tickets — please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  onTicketCreated(ticket: Ticket): void {
    this.tickets.update((prev) => [ticket, ...prev]);
    this.total.update((n) => n + 1);
    this.showForm.set(false);
  }

  prevPage(): void { this.offset.update((o) => Math.max(0, o - PAGE_SIZE)); void this.load(); }
  nextPage(): void { this.offset.update((o) => o + PAGE_SIZE); void this.load(); }
}
