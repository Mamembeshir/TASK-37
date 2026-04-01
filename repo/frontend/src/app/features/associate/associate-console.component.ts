import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { TicketService } from '../../core/services/ticket.service';
import { ToastService } from '../../core/services/toast.service';
import { TicketTimelineComponent } from '../tickets/ticket-timeline.component';
import {
  type Ticket,
  TICKET_TYPE_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_BADGE,
  DEPT_LABEL,
} from '../../core/models/ticket.model';

type Dept = 'all' | 'front_desk' | 'fulfillment' | 'accounting';
type TriageTab = 'action' | 'timeline';

const DEPT_TABS: { value: Dept; label: string }[] = [
  { value: 'all',         label: 'All Active' },
  { value: 'front_desk',  label: 'Front Desk' },
  { value: 'fulfillment', label: 'Fulfillment' },
  { value: 'accounting',  label: 'Accounting' },
];

const PAGE_SIZE = 15;

/** Guided triage prompts per ticket type (task 184). */
const TRIAGE_PROMPTS: Record<string, string[]> = {
  return:           [
    'Has the customer physically returned the item?',
    'Is the item in acceptable resale condition?',
    'Does the item match the order description?',
  ],
  refund:           [
    'Has the refund amount been confirmed with the customer?',
    'Is the order status "picked up" in the system?',
    'Are there any outstanding balance holds on the account?',
  ],
  price_adjustment: [
    'Does the receipt reference match the transaction record?',
    'Is the requested adjustment within the $50 order cap?',
    'Has the original purchase price been verified?',
  ],
};

@Component({
  selector: 'app-associate-console',
  standalone: true,
  imports: [FormsModule, RouterLink, TicketTimelineComponent],
  template: `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8 animate-fade-in">

      <!-- Header -->
      <div class="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900 tracking-tight">Ticket Queue</h1>
          <p class="mt-1 text-sm text-zinc-700">
            Active tickets across all departments.
            @if (total() > 0) {
              <span class="text-zinc-700 font-medium">{{ total() }} open.</span>
            }
          </p>
        </div>
        <a routerLink="/associate"
          class="text-xs text-zinc-700 hover:text-zinc-700 transition-colors flex items-center gap-1">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
               viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Console
        </a>
      </div>

      <div class="flex gap-6 items-start"
           [class]="selectedTicket() ? 'lg:flex-row' : ''">

        <!-- ── Queue panel ─────────────────────────────────────────────────── -->
        <div [class]="selectedTicket() ? 'lg:w-[38%] shrink-0' : 'w-full'">

          <!-- Dept filter tabs -->
          <div class="flex gap-1 mb-4 bg-zinc-100 rounded-xl p-1 border border-zinc-200">
            @for (tab of deptTabs; track tab.value) {
              <button type="button"
                class="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150"
                [class]="activeDept() === tab.value
                  ? 'bg-zinc-700/80 text-zinc-900 shadow-sm'
                  : 'text-zinc-700 hover:text-zinc-700'"
                (click)="setDept(tab.value)">
                {{ tab.label }}
              </button>
            }
          </div>

          <!-- Loading -->
          @if (loading()) {
            <div class="space-y-2">
              @for (i of [1,2,3,4,5]; track i) {
                <div class="glass rounded-xl border border-zinc-200 p-3 animate-pulse flex gap-3">
                  <div class="flex-1 space-y-1.5">
                    <div class="h-3 w-28 bg-zinc-800 rounded"></div>
                    <div class="h-2.5 w-20 bg-zinc-100 rounded"></div>
                  </div>
                  <div class="h-5 w-16 bg-zinc-50 rounded-full self-start"></div>
                </div>
              }
            </div>
          }

          <!-- Empty state -->
          @if (!loading() && tickets().length === 0) {
            <div class="text-center py-12 glass rounded-2xl border border-zinc-200">
              <svg class="w-8 h-8 text-zinc-700 mx-auto mb-2" fill="none" stroke="currentColor"
                   stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p class="text-sm text-zinc-800">Queue is clear!</p>
            </div>
          }

          <!-- Ticket rows -->
          @if (!loading() && tickets().length > 0) {
            <div class="space-y-2">
              @for (t of tickets(); track t.id) {
                <button type="button"
                  class="w-full text-left glass rounded-xl border p-3 transition-all duration-150
                         flex items-start justify-between gap-2 group"
                  [class]="selectedTicket()?.id === t.id
                    ? 'border-[#c4832a]/20 bg-amber-500/[0.04] shadow-[0_0_12px_rgba(245,158,11,0.05)]'
                    : 'border-zinc-200 hover:border-zinc-300'"
                  (click)="selectTicket(t)">
                  <div class="min-w-0 space-y-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-xs font-semibold text-zinc-800">
                        {{ typeLabel(t.type) }}
                      </span>
                      <span class="badge border text-[9px] px-1.5 py-0.5
                                   {{ statusBadge(t.status) }}">
                        {{ statusLabel(t.status) }}
                      </span>
                    </div>
                    <p class="text-[10px] text-zinc-800 font-mono">
                      {{ t.id.slice(0, 8).toUpperCase() }}… · {{ deptLabel(t.department) }}
                    </p>
                    <p class="text-[10px] text-zinc-700">
                      {{ formatDate(t.createdAt) }}
                    </p>
                  </div>
                  <svg class="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-700 mt-0.5 shrink-0
                              transition-colors"
                       fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              }
            </div>

            <!-- Pagination -->
            @if (total() > PAGE_SIZE) {
              <div class="flex items-center justify-between mt-4">
                <span class="text-[10px] text-zinc-700">
                  {{ offset() + 1 }}–{{ Math.min(offset() + PAGE_SIZE, total()) }}
                  of {{ total() }}
                </span>
                <div class="flex gap-1.5">
                  <button type="button"
                    class="px-2.5 py-1 text-[10px] rounded-lg border border-zinc-200 text-zinc-700
                           hover:text-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed
                           transition-colors"
                    [disabled]="offset() === 0" (click)="prevPage()">Prev</button>
                  <button type="button"
                    class="px-2.5 py-1 text-[10px] rounded-lg border border-zinc-200 text-zinc-700
                           hover:text-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed
                           transition-colors"
                    [disabled]="offset() + PAGE_SIZE >= total()" (click)="nextPage()">Next</button>
                </div>
              </div>
            }
          }
        </div>

        <!-- ── Work panel (shown when ticket selected) ──────────────────────── -->
        @if (selectedTicket()) {
          <div class="flex-1 min-w-0 space-y-4 animate-scale-in">

            <!-- Ticket header -->
            <div class="glass rounded-2xl border border-zinc-200 p-5 space-y-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-bold text-zinc-900">
                    {{ typeLabel(selectedTicket()!.type) }}
                  </h2>
                  <p class="text-xs font-mono text-zinc-800 mt-0.5">
                    {{ selectedTicket()!.id }}
                  </p>
                </div>
                <div class="flex flex-col items-end gap-1.5">
                  <span class="badge border text-[10px] px-2.5 py-1
                               {{ statusBadge(selectedTicket()!.status) }}">
                    {{ statusLabel(selectedTicket()!.status) }}
                  </span>
                  <button type="button"
                    class="text-[10px] text-zinc-800 hover:text-zinc-700 transition-colors"
                    (click)="selectedTicket.set(null)">
                    Dismiss ×
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p class="text-[10px] text-zinc-800 uppercase tracking-wider mb-0.5">Dept</p>
                  <p class="text-zinc-700 font-medium">{{ deptLabel(selectedTicket()!.department) }}</p>
                </div>
                <div>
                  <p class="text-[10px] text-zinc-800 uppercase tracking-wider mb-0.5">Order</p>
                  <p class="text-zinc-700 font-mono">{{ selectedTicket()!.orderId.slice(0,8).toUpperCase() }}…</p>
                </div>
                <div>
                  <p class="text-[10px] text-zinc-800 uppercase tracking-wider mb-0.5">Window</p>
                  <p class="text-zinc-700">{{ selectedTicket()!.windowDays }}d</p>
                </div>
              </div>

              @if (selectedTicket()!.receiptReference) {
                <div class="px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200">
                  <p class="text-[10px] text-zinc-800 uppercase tracking-wider mb-0.5">Receipt ref</p>
                  <p class="text-xs text-zinc-700 font-mono">{{ selectedTicket()!.receiptReference }}</p>
                </div>
              }
            </div>

            <!-- Action / Timeline tabs -->
            <div class="flex gap-1 bg-zinc-100 rounded-xl p-1 border border-zinc-200">
              @for (tab of triageTabs; track tab) {
                <button type="button"
                  class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  [class]="activeTriageTab() === tab
                    ? 'bg-zinc-700/80 text-zinc-900'
                    : 'text-zinc-700 hover:text-zinc-700'"
                  (click)="activeTriageTab.set(tab)">
                  {{ tab === 'action' ? 'Actions' : 'Timeline' }}
                </button>
              }
            </div>

            <!-- ── Actions tab ──────────────────────────────────────────── -->
            @if (activeTriageTab() === 'action') {
              <div class="space-y-4">

                <!-- Guided questions (task 184) -->
                <div class="glass rounded-2xl border border-amber-500/15
                            bg-amber-500/[0.02] p-4 space-y-3">
                  <p class="text-xs font-semibold text-[#c4832a] uppercase tracking-wider">
                    Guided Checklist
                  </p>
                  @for (q of triagePrompts(); track q; let i = $index) {
                    <label class="flex items-start gap-2.5 cursor-pointer group">
                      <input type="checkbox" class="mt-0.5 accent-green-500 cursor-pointer"
                             [(ngModel)]="checklistState[i]" />
                      <span class="text-xs leading-relaxed transition-colors"
                            [class]="checklistState[i] ? 'text-zinc-700 line-through' : 'text-zinc-700'">
                        {{ q }}
                      </span>
                    </label>
                  }
                </div>

                <!-- Action form -->
                <div class="glass rounded-2xl border border-zinc-200 p-5 space-y-4">
                  <p class="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                    Action
                  </p>

                  <!-- Dept override (for triage) -->
                  @if (canTriage()) {
                    <div class="space-y-1.5">
                      <label class="text-xs text-zinc-700">Route to department</label>
                      <select class="input-field py-2 text-sm cursor-pointer"
                              [(ngModel)]="triageDept">
                        <option value="">Keep current ({{ deptLabel(selectedTicket()!.department) }})</option>
                        <option value="front_desk">Front Desk</option>
                        <option value="fulfillment">Fulfillment</option>
                        <option value="accounting">Accounting</option>
                      </select>
                      @if (triageDept) {
                        <p class="text-[10px] text-[#c4832a] flex items-center gap-1">
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2"
                               viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round"
                              d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </svg>
                          Will route to {{ deptLabel(triageDept) }}
                        </p>
                      }
                    </div>
                  }

                  <!-- Outcome (for resolve) -->
                  @if (canResolve()) {
                    <div class="space-y-1.5">
                      <label class="text-xs text-zinc-700">Outcome <span class="text-red-400">*</span></label>
                      <div class="flex gap-2">
                        @for (o of outcomes; track o.value) {
                          <button type="button"
                            class="flex-1 py-2 rounded-xl text-xs font-medium border transition-colors"
                            [class]="resolveOutcome === o.value
                              ? o.activeClass
                              : 'border-zinc-200 text-zinc-800 hover:text-zinc-700 hover:border-zinc-300'"
                            (click)="resolveOutcome = o.value">
                            {{ o.label }}
                          </button>
                        }
                      </div>
                    </div>

                    @if (resolveOutcome === 'adjusted') {
                      <div class="space-y-1.5 animate-scale-in">
                        <label class="text-xs text-zinc-700">
                          Adjustment amount <span class="text-red-400">*</span>
                          <span class="text-zinc-700 ml-1">(≤ $50.00)</span>
                        </label>
                        <input type="number" step="0.01" min="0.01" max="50"
                               class="input-field py-2 text-sm"
                               placeholder="0.00"
                               [(ngModel)]="adjustmentAmount" />
                      </div>
                    }
                  }

                  <!-- Note field -->
                  <div class="space-y-1.5">
                    <label class="text-xs text-zinc-700">Internal note (optional)</label>
                    <textarea class="input-field text-sm resize-none"
                              rows="2"
                              placeholder="Add context for this action…"
                              [(ngModel)]="actionNote"
                              maxlength="2000">
                    </textarea>
                  </div>

                  <!-- API error -->
                  @if (actionError()) {
                    <div class="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25
                                text-xs text-red-300">
                      {{ actionError() }}
                    </div>
                  }

                  <!-- Action buttons -->
                  <div class="flex flex-wrap gap-2">
                    @if (canCheckin()) {
                      <button type="button"
                        class="btn-primary py-2 px-4 text-xs flex items-center gap-1.5
                               disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                        [disabled]="acting()"
                        (click)="doCheckin()">
                        @if (acting()) {
                          <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor"
                              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                          </svg>
                        }
                        Check In
                      </button>
                    }

                    @if (canTriage()) {
                      <button type="button"
                        class="py-2 px-4 text-xs rounded-xl font-medium border border-violet-500/30
                               bg-violet-500/10 text-violet-300 hover:bg-violet-500/20
                               hover:border-violet-500/40 transition-colors
                               flex items-center gap-1.5
                               disabled:opacity-50 disabled:cursor-not-allowed"
                        [disabled]="acting()"
                        (click)="doTriage()">
                        Triage
                        @if (triageDept) {
                          <span class="text-[9px] text-violet-400">→ {{ deptLabel(triageDept) }}</span>
                        }
                      </button>
                    }

                    @if (canInterrupt()) {
                      <button type="button"
                        class="py-2 px-4 text-xs rounded-xl font-medium border border-red-500/25
                               bg-red-500/8 text-red-300 hover:bg-red-500/15
                               hover:border-red-500/35 transition-colors
                               disabled:opacity-50 disabled:cursor-not-allowed"
                        [disabled]="acting()"
                        (click)="doInterrupt()">
                        Interrupt
                      </button>
                    }

                    @if (canResolve()) {
                      <button type="button"
                        class="py-2 px-4 text-xs rounded-xl font-medium border border-[#c4832a]/20
                               bg-amber-500/8 text-[#c4832a] hover:bg-[#c4832a]/10
                               hover:border-amber-500/35 transition-colors
                               flex items-center gap-1.5
                               disabled:opacity-50 disabled:cursor-not-allowed"
                        [disabled]="acting() || !resolveOutcome ||
                          (resolveOutcome === 'adjusted' && !adjustmentAmount)"
                        (click)="doResolve()">
                        Resolve
                        @if (resolveOutcome) {
                          <span class="text-[9px]">— {{ resolveOutcome }}</span>
                        }
                      </button>
                    }
                  </div>
                </div>
              </div>
            }

            <!-- ── Timeline tab ─────────────────────────────────────────── -->
            @if (activeTriageTab() === 'timeline') {
              <div class="glass rounded-2xl border border-zinc-200 p-5">
                <app-ticket-timeline
                  [events]="selectedTicket()!.events ?? []"
                  [assignedToId]="selectedTicket()!.assignedTo"
                  [ticketStatus]="selectedTicket()!.status"
                />
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AssociateConsoleComponent implements OnInit {
  private readonly ticketSvc = inject(TicketService);
  private readonly toast      = inject(ToastService);

  readonly loading        = signal(true);
  readonly tickets        = signal<Ticket[]>([]);
  readonly total          = signal(0);
  readonly offset         = signal(0);
  readonly activeDept     = signal<Dept>('all');
  readonly selectedTicket = signal<Ticket | null>(null);
  readonly acting         = signal(false);
  readonly actionError    = signal<string | null>(null);
  readonly activeTriageTab = signal<TriageTab>('action');

  readonly deptTabs  = DEPT_TABS;
  readonly triageTabs: TriageTab[] = ['action', 'timeline'];
  readonly PAGE_SIZE = PAGE_SIZE;
  readonly Math      = Math;

  readonly outcomes = [
    { value: 'approved', label: 'Approved', activeClass: 'border-[#c4832a]/30 bg-[#c4832a]/10 text-[#c4832a]' },
    { value: 'rejected', label: 'Rejected', activeClass: 'border-red-500/30 bg-red-500/8 text-red-300' },
    { value: 'adjusted', label: 'Adjusted', activeClass: 'border-[#c4832a]/20 bg-amber-500/8 text-[#c4832a]' },
  ];

  triageDept        = '';
  actionNote        = '';
  resolveOutcome    = '';
  adjustmentAmount: number | null = null;
  checklistState:   boolean[] = [];

  readonly triagePrompts = computed(() =>
    TRIAGE_PROMPTS[this.selectedTicket()?.type ?? ''] ?? [],
  );

  readonly canCheckin   = computed(() => this.selectedTicket()?.status === 'open');
  readonly canTriage    = computed(() => this.selectedTicket()?.status === 'in_progress');
  readonly canInterrupt = computed(() => this.selectedTicket()?.status === 'in_progress');
  readonly canResolve   = computed(() =>
    ['in_progress', 'pending_inspection'].includes(this.selectedTicket()?.status ?? ''),
  );

  typeLabel(t: string): string   { return TICKET_TYPE_LABEL[t as keyof typeof TICKET_TYPE_LABEL] ?? t; }
  statusLabel(s: string): string { return TICKET_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string { return TICKET_STATUS_BADGE[s] ?? ''; }
  deptLabel(d: string): string   { return DEPT_LABEL[d] ?? d; }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    });
  }

  ngOnInit(): void { void this.loadQueue(); }

  setDept(d: Dept): void {
    this.activeDept.set(d);
    this.offset.set(0);
    this.selectedTicket.set(null);
    void this.loadQueue();
  }

  async loadQueue(): Promise<void> {
    this.loading.set(true);
    try {
      const dept = this.activeDept() === 'all' ? undefined : this.activeDept();
      const res  = await firstValueFrom(
        this.ticketSvc.listQueue({ limit: PAGE_SIZE, offset: this.offset(), department: dept }),
      );
      this.tickets.set(res.data);
      this.total.set(res.total);
    } catch {
      this.toast.error('Could not load ticket queue.');
    } finally {
      this.loading.set(false);
    }
  }

  async selectTicket(t: Ticket): Promise<void> {
    // Load full detail (includes events)
    try {
      const full = await firstValueFrom(this.ticketSvc.get(t.id));
      this.selectedTicket.set(full);
      this.resetActionForm();
      this.activeTriageTab.set('action');
      this.checklistState = (TRIAGE_PROMPTS[full.type] ?? []).map(() => false);
    } catch {
      this.toast.error('Could not load ticket detail.');
    }
  }

  private resetActionForm(): void {
    this.triageDept     = '';
    this.actionNote     = '';
    this.resolveOutcome = '';
    this.adjustmentAmount = null;
    this.actionError.set(null);
  }

  private async runAction(fn: () => Promise<Ticket>): Promise<void> {
    if (this.acting()) return;
    this.acting.set(true);
    this.actionError.set(null);
    try {
      const updated = await fn();
      // Refresh full detail to get latest events
      const full = await firstValueFrom(this.ticketSvc.get(updated.id));
      this.selectedTicket.set(full);
      // Update row in queue
      this.tickets.update((list) => list.map((t) => t.id === full.id ? full : t));
      // Remove from queue if now terminal
      if (['resolved', 'cancelled'].includes(full.status)) {
        this.tickets.update((list) => list.filter((t) => t.id !== full.id));
        this.total.update((n) => n - 1);
        this.selectedTicket.set(null);
      }
      this.resetActionForm();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      this.actionError.set(
        (e.error as { error?: string })?.error ?? 'Action failed — please try again.',
      );
    } finally {
      this.acting.set(false);
    }
  }

  async doCheckin(): Promise<void> {
    await this.runAction(async () => {
      const t = await firstValueFrom(
        this.ticketSvc.checkin(this.selectedTicket()!.id, this.actionNote || undefined),
      );
      this.toast.success('Ticket checked in — now in progress.');
      return t;
    });
  }

  async doTriage(): Promise<void> {
    await this.runAction(async () => {
      const t = await firstValueFrom(
        this.ticketSvc.triage(this.selectedTicket()!.id, {
          department: this.triageDept || undefined,
          note: this.actionNote || undefined,
        }),
      );
      const dest = this.triageDept ? this.deptLabel(this.triageDept) : 'same dept';
      this.toast.success(`Ticket triaged → ${dest}.`);
      return t;
    });
  }

  async doInterrupt(): Promise<void> {
    await this.runAction(async () => {
      const t = await firstValueFrom(
        this.ticketSvc.interrupt(this.selectedTicket()!.id, this.actionNote || undefined),
      );
      this.toast.warning('Ticket interrupted — pending re-inspection.');
      return t;
    });
  }

  async doResolve(): Promise<void> {
    await this.runAction(async () => {
      const body: { outcome: 'approved' | 'rejected' | 'adjusted'; note?: string; adjustmentAmount?: number } = {
        outcome: this.resolveOutcome as 'approved' | 'rejected' | 'adjusted',
        note: this.actionNote || undefined,
      };
      if (this.resolveOutcome === 'adjusted' && this.adjustmentAmount) {
        body.adjustmentAmount = this.adjustmentAmount;
      }
      const t = await firstValueFrom(this.ticketSvc.resolve(this.selectedTicket()!.id, body));
      this.toast.success(`Ticket resolved — ${this.resolveOutcome}.`);
      return t;
    });
  }

  prevPage(): void { this.offset.update((o) => Math.max(0, o - PAGE_SIZE)); void this.loadQueue(); }
  nextPage(): void { this.offset.update((o) => o + PAGE_SIZE); void this.loadQueue(); }
}
