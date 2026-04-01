import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { TicketService } from '../../core/services/ticket.service';
import { ToastService } from '../../core/services/toast.service';
import {
  type Ticket,
  TICKET_TYPE_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_BADGE,
  TICKET_OUTCOME_BADGE,
  DEPT_LABEL,
  formatDuration,
} from '../../core/models/ticket.model';
import { TicketTimelineComponent } from './ticket-timeline.component';

@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [RouterLink, TicketTimelineComponent],
  template: `
    <div class="max-w-2xl mx-auto px-4 sm:px-6 py-8 animate-fade-in space-y-6">

      <!-- Breadcrumb -->
      <div class="flex items-center gap-1.5 text-xs text-zinc-700">
        <a routerLink="/tickets" class="hover:text-zinc-700 transition-colors">Tickets</a>
        <span class="text-zinc-700">/</span>
        <span class="font-mono">{{ ticketId().slice(0, 8).toUpperCase() }}…</span>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-4 animate-pulse">
          <div class="glass rounded-2xl border border-zinc-200 p-6 space-y-3">
            <div class="h-4 w-32 bg-zinc-800 rounded"></div>
            <div class="h-3 w-48 bg-zinc-100 rounded"></div>
          </div>
          <div class="glass rounded-2xl border border-zinc-200 p-6 space-y-4">
            @for (i of [1, 2, 3]; track i) {
              <div class="flex gap-3">
                <div class="w-7 h-7 rounded-full bg-zinc-800 shrink-0"></div>
                <div class="flex-1 space-y-1.5 pt-1">
                  <div class="h-3 w-24 bg-zinc-800 rounded"></div>
                  <div class="h-2.5 w-40 bg-zinc-100 rounded"></div>
                </div>
              </div>
            }
          </div>
        </div>
      }

      @if (!loading() && !loadError() && ticket()) {
        <!-- Ticket header card -->
        <div class="glass rounded-2xl border border-zinc-200 p-6 space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <h1 class="text-xl font-bold text-zinc-900">
                {{ typeLabel(ticket()!.type) }}
              </h1>
              <p class="text-xs font-mono text-zinc-800">
                {{ ticket()!.id }}
              </p>
            </div>
            <div class="flex flex-col items-end gap-1.5 shrink-0">
              <span class="badge border text-[10px] px-2.5 py-1
                           {{ statusBadge(ticket()!.status) }}">
                {{ statusLabel(ticket()!.status) }}
              </span>
              @if (ticket()!.outcome) {
                <span class="badge border text-[10px] px-2.5 py-1
                             {{ outcomeBadge(ticket()!.outcome!) }}">
                  {{ ticket()!.outcome }}
                </span>
              }
            </div>
          </div>

          <!-- Meta grid -->
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-0.5">
              <p class="text-[10px] text-zinc-800 uppercase tracking-wider">Department</p>
              <p class="text-xs text-zinc-700 font-medium">{{ deptLabel(ticket()!.department) }}</p>
            </div>
            <div class="space-y-0.5">
              <p class="text-[10px] text-zinc-800 uppercase tracking-wider">Order</p>
              <p class="text-xs font-mono text-zinc-700">
                {{ ticket()!.orderId.slice(0, 8).toUpperCase() }}…
              </p>
            </div>
            <div class="space-y-0.5">
              <p class="text-[10px] text-zinc-800 uppercase tracking-wider">Return window</p>
              <p class="text-xs text-zinc-700">{{ ticket()!.windowDays }} days</p>
            </div>
            <div class="space-y-0.5">
              <p class="text-[10px] text-zinc-800 uppercase tracking-wider">Opened</p>
              <p class="text-xs text-zinc-700">{{ formatDate(ticket()!.createdAt) }}</p>
            </div>
            @if (ticket()!.receiptReference) {
              <div class="col-span-2 space-y-0.5">
                <p class="text-[10px] text-zinc-800 uppercase tracking-wider">Receipt reference</p>
                <p class="text-xs text-zinc-700 font-mono">{{ ticket()!.receiptReference }}</p>
              </div>
            }
            @if (ticket()!.resolvedAt) {
              <div class="col-span-2 space-y-0.5">
                <p class="text-[10px] text-zinc-800 uppercase tracking-wider">Resolved</p>
                <p class="text-xs text-zinc-700">{{ formatDate(ticket()!.resolvedAt!) }}</p>
              </div>
            }
          </div>
        </div>

        <!-- Event timeline — now uses shared TicketTimelineComponent (tasks 185+186) -->
        <div class="space-y-3">
          @if (ticket()!.events && ticket()!.events!.length > 0) {
            <h2 class="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
              Timeline · {{ ticket()!.events!.length }} event{{ ticket()!.events!.length === 1 ? '' : 's' }}
            </h2>
          }
          <div class="glass rounded-2xl border border-zinc-200 p-4">
            <app-ticket-timeline
              [events]="ticket()!.events ?? []"
              [assignedToId]="ticket()!.assignedTo"
              [ticketStatus]="ticket()!.status"
            />
          </div>
        </div>
      }
    </div>
  `,
})
export class TicketDetailComponent implements OnInit {
  private readonly route     = inject(ActivatedRoute);
  private readonly ticketSvc = inject(TicketService);
  private readonly toast     = inject(ToastService);

  readonly ticketId  = signal('');
  readonly ticket    = signal<Ticket | null>(null);
  readonly loading   = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly formatDuration = formatDuration;

  typeLabel(t: string): string    { return TICKET_TYPE_LABEL[t as keyof typeof TICKET_TYPE_LABEL] ?? t; }
  statusLabel(s: string): string  { return TICKET_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string  { return TICKET_STATUS_BADGE[s] ?? ''; }
  outcomeBadge(o: string): string { return TICKET_OUTCOME_BADGE[o] ?? ''; }
  deptLabel(d: string): string    { return DEPT_LABEL[d] ?? d; }
  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  ngOnInit(): void {
    this.ticketId.set(this.route.snapshot.paramMap.get('id') ?? '');
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const ticket = await firstValueFrom(this.ticketSvc.get(this.ticketId()));
      this.ticket.set(ticket);
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg = e.status === 404 ? 'Ticket not found.' : 'Could not load ticket. Please try again.';
      this.loadError.set(msg);
      this.toast.error(msg);
    } finally {
      this.loading.set(false);
    }
  }
}
