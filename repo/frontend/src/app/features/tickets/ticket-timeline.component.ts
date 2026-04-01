import { Component, Input, computed, signal } from '@angular/core';
import {
  type TicketEvent,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_ICON,
  EVENT_TYPE_COLOR,
  DEPT_LABEL,
  formatDuration,
} from '../../core/models/ticket.model';

/** Statuses that make the ticket "active" for current-node highlighting. */
const ACTIVE_STATUSES = new Set(['open', 'in_progress', 'pending_inspection']);

@Component({
  selector: 'app-ticket-timeline',
  standalone: true,
  template: `
    @if (events.length === 0) {
      <div class="text-center py-8">
        <p class="text-xs text-zinc-800">No timeline events yet.</p>
      </div>
    } @else {
      <div class="space-y-0 relative">

        <!-- Vertical rail -->
        <div class="absolute left-[13px] top-3.5 bottom-3.5 w-px bg-zinc-800/80"></div>

        @for (event of events; track event.id; let i = $index; let last = $last) {

          <!-- ── Interrupt / pending-inspection marker (task 186) ── -->
          @if (event.eventType === 'interrupted') {
            <div class="relative z-10 mb-1 ml-8 flex items-center gap-2
                        px-3 py-1.5 rounded-lg bg-red-500/8 border border-red-500/20
                        animate-scale-in">
              <svg class="w-3 h-3 text-red-400 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0
                     2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898
                     0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span class="text-[10px] font-semibold text-red-300 uppercase tracking-wide">
                Re-inspection required
              </span>
            </div>
          }

          <div class="relative flex gap-4 pb-5" [class.pb-1]="last">

            <!-- Node dot -->
            <div class="relative z-10 shrink-0 mt-0.5">
              <div class="w-7 h-7 rounded-full border flex items-center justify-center
                          transition-all duration-200"
                   [class]="nodeClass(event, i, last)">
                <svg class="w-3 h-3" fill="none" stroke="currentColor"
                     stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    [attr.d]="icon(event.eventType)" />
                </svg>
              </div>

              <!-- Pulse ring for the active/last node -->
              @if (isActiveNode(i, last)) {
                <div class="absolute inset-0 rounded-full animate-ping opacity-30"
                     [class]="activePing(event.eventType)"></div>
              }
            </div>

            <!-- Event content -->
            <div class="flex-1 min-w-0 pt-0.5">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-0.5 min-w-0">

                  <!-- Label -->
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="text-sm font-semibold"
                       [class]="isActiveNode(i, last) ? 'text-zinc-900' : 'text-zinc-700'">
                      {{ label(event.eventType) }}
                    </p>

                    <!-- Current owner indicator -->
                    @if (isActiveNode(i, last) && assignedToId && event.actorId === assignedToId) {
                      <span class="text-[9px] px-1.5 py-0.5 rounded-full font-semibold
                                   bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]">
                        Current owner
                      </span>
                    }

                    <!-- Pending inspection badge (task 186) -->
                    @if (ticketStatus === 'pending_inspection' && isActiveNode(i, last)) {
                      <span class="text-[9px] px-1.5 py-0.5 rounded-full font-semibold
                                   bg-red-500/15 border border-red-500/25 text-red-400">
                        Awaiting re-inspection
                      </span>
                    }
                  </div>

                  <!-- Department transition -->
                  @if (event.fromDept && event.toDept) {
                    <div class="flex items-center gap-1.5 text-xs">
                      <span class="text-zinc-700">{{ deptLabel(event.fromDept) }}</span>
                      <svg class="w-3 h-3 text-zinc-700" fill="none" stroke="currentColor"
                           stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round"
                          d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                      </svg>
                      <span class="font-medium text-zinc-700">{{ deptLabel(event.toDept) }}</span>
                    </div>
                  }

                  <!-- Note -->
                  @if (event.note) {
                    <p class="text-xs text-zinc-700 italic leading-relaxed mt-0.5 max-w-xs">
                      "{{ event.note }}"
                    </p>
                  }

                  <!-- Actor -->
                  @if (event.actorId) {
                    <p class="text-[10px] text-zinc-700 font-mono mt-0.5">
                      {{ event.actorId.slice(0, 8) }}…
                    </p>
                  }
                </div>

                <!-- Duration + time -->
                <div class="text-right shrink-0 space-y-0.5">
                  @if (event.nodeDurationMs) {
                    <p class="text-xs font-semibold text-[#c4832a]/90">
                      {{ dur(event.nodeDurationMs) }}
                    </p>
                  }
                  <p class="text-[10px] text-zinc-700">{{ time(event.createdAt) }}</p>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- Current status tail (task 186 — show live pending_inspection state) -->
        @if (ticketStatus === 'pending_inspection') {
          <div class="relative flex gap-4">
            <div class="relative z-10 shrink-0">
              <div class="w-7 h-7 rounded-full border border-red-500/40 bg-red-500/10
                          flex items-center justify-center">
                <svg class="w-3 h-3 text-red-400" fill="none" stroke="currentColor"
                     stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25
                       2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25
                       2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <div class="absolute inset-0 rounded-full animate-ping opacity-25 bg-red-500"></div>
            </div>
            <div class="pt-1.5">
              <p class="text-sm font-semibold text-red-300">Pending Re-inspection</p>
              <p class="text-[10px] text-zinc-800 mt-0.5">Awaiting associate action</p>
            </div>
          </div>
        }

        @if (ticketStatus === 'in_progress') {
          <div class="relative flex gap-4">
            <div class="relative z-10 shrink-0">
              <div class="w-7 h-7 rounded-full border border-sky-500/30 bg-sky-500/8
                          flex items-center justify-center">
                <svg class="w-2 h-2 rounded-full bg-sky-400" viewBox="0 0 8 8">
                  <circle cx="4" cy="4" r="4" fill="currentColor" />
                </svg>
              </div>
              <div class="absolute inset-0 rounded-full animate-ping opacity-20 bg-sky-500"></div>
            </div>
            <div class="pt-1.5">
              <p class="text-sm font-semibold text-sky-300">In Progress</p>
              <p class="text-[10px] text-zinc-800 mt-0.5">Currently being handled</p>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class TicketTimelineComponent {
  @Input({ required: true }) events!: TicketEvent[];
  /** UUID of the currently assigned associate — used for "current owner" badge. */
  @Input() assignedToId: string | null = null;
  /** Current ticket status — drives live tail node and interrupt markers (task 186). */
  @Input() ticketStatus = '';

  readonly dur       = formatDuration;
  readonly label     = (e: string) => EVENT_TYPE_LABEL[e] ?? e;
  readonly icon      = (e: string) => EVENT_TYPE_ICON[e] ?? EVENT_TYPE_ICON['created'];
  readonly deptLabel = (d: string) => DEPT_LABEL[d] ?? d;

  time(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /** True when this is the last event AND the ticket is still active. */
  isActiveNode(index: number, isLast: boolean): boolean {
    return isLast && ACTIVE_STATUSES.has(this.ticketStatus);
  }

  nodeClass(event: TicketEvent, index: number, isLast: boolean): string {
    const base = EVENT_TYPE_COLOR[event.eventType] ?? EVENT_TYPE_COLOR['created'];
    if (this.isActiveNode(index, isLast)) {
      return base + ' scale-110 shadow-[0_0_8px_rgba(0,0,0,0.4)]';
    }
    return base;
  }

  activePing(eventType: string): string {
    if (eventType === 'interrupted') return 'bg-red-500';
    if (eventType === 'checked_in')  return 'bg-sky-500';
    if (eventType === 'triaged')     return 'bg-violet-500';
    return 'bg-zinc-500';
  }
}
