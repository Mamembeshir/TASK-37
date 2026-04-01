import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type Ticket,
  TICKET_TYPE_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_BADGE,
  TICKET_OUTCOME_BADGE,
  DEPT_LABEL,
} from '../../core/models/ticket.model';

@Component({
  selector: 'app-ticket-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (tickets.length === 0) {
      <div class="text-center py-12 space-y-2">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl
                    bg-zinc-100 border border-zinc-200 mb-2">
          <svg class="w-5.5 h-5.5 text-zinc-800" fill="none" stroke="currentColor"
               stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a3 3 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
          </svg>
        </div>
        <p class="text-sm text-zinc-700">No support tickets yet.</p>
      </div>
    } @else {
      <div class="space-y-3">
        @for (ticket of tickets; track ticket.id) {
          <a [routerLink]="['/tickets', ticket.id]"
            class="group block glass rounded-2xl border border-zinc-200 p-4
                   hover:border-zinc-300 transition-all duration-150
                   hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)] no-underline">

            <div class="flex items-start justify-between gap-3">
              <!-- Left -->
              <div class="space-y-1.5 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <!-- Type chip -->
                  <span class="text-xs font-semibold text-zinc-800">
                    {{ typeLabel(ticket.type) }}
                  </span>
                  <!-- Status badge -->
                  <span class="badge border text-[10px] px-2 py-0.5
                               {{ statusBadge(ticket.status) }}">
                    {{ statusLabel(ticket.status) }}
                  </span>
                  <!-- Outcome badge -->
                  @if (ticket.outcome) {
                    <span class="badge border text-[10px] px-2 py-0.5
                                 {{ outcomeBadge(ticket.outcome) }}">
                      {{ ticket.outcome }}
                    </span>
                  }
                </div>

                <!-- Order + dept -->
                <div class="flex items-center gap-3 text-[10px] text-zinc-800">
                  <span class="font-mono">Order {{ ticket.orderId.slice(0, 8).toUpperCase() }}…</span>
                  <span class="text-zinc-700">·</span>
                  <span>{{ deptLabel(ticket.department) }}</span>
                </div>

                <!-- Date -->
                <p class="text-[10px] text-zinc-700">
                  Opened {{ formatDate(ticket.createdAt) }}
                  @if (ticket.resolvedAt) {
                    · Resolved {{ formatDate(ticket.resolvedAt) }}
                  }
                </p>
              </div>

              <!-- Right: chevron -->
              <svg class="w-4 h-4 text-zinc-700 group-hover:text-zinc-700 mt-1 shrink-0
                          transition-colors"
                   fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </a>
        }
      </div>
    }
  `,
})
export class TicketListComponent {
  @Input({ required: true }) tickets!: Ticket[];

  typeLabel(t: string): string   { return TICKET_TYPE_LABEL[t as keyof typeof TICKET_TYPE_LABEL] ?? t; }
  statusLabel(s: string): string { return TICKET_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string { return TICKET_STATUS_BADGE[s] ?? ''; }
  outcomeBadge(o: string): string{ return TICKET_OUTCOME_BADGE[o] ?? ''; }
  deptLabel(d: string): string   { return DEPT_LABEL[d] ?? d; }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }
}
