import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

const PAGE_SIZE = 50;

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  note: string | null;
  createdAt: string;
}

interface AuditLogListResponse {
  data: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

// Colour coding per entity type
const ENTITY_BADGE: Record<string, string> = {
  product:    'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  order:      'bg-sky-50 border-sky-200 text-sky-300',
  ticket:     'bg-violet-500/10 border-violet-500/20 text-violet-300',
  review:     'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  user:       'bg-zinc-500/10 border-zinc-500/20 text-zinc-700',
  rule_set:   'bg-indigo-500/10 border-indigo-500/20 text-indigo-300',
  banned_term:'bg-red-500/10 border-red-500/20 text-red-300',
  campaign:   'bg-pink-500/10 border-pink-500/20 text-pink-300',
};

function entityBadge(type: string): string {
  return ENTITY_BADGE[type] ?? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-700';
}

// Collapse/expand diff display
function diffLines(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  try { return JSON.stringify(val, null, 2).split('\n'); } catch { return [String(val)]; }
}

@Component({
  selector: 'app-admin-audit-log',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900">Audit Log</h1>
        <p class="text-sm text-zinc-700 mt-0.5">
          Immutable record of all system actions — read only, append only
        </p>
      </div>

      <!-- Filters -->
      <div class="card p-4 flex flex-wrap gap-3 items-end">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-zinc-700 font-medium">Entity type</label>
          <select class="input-field py-2 text-sm w-40 cursor-pointer"
                  [ngModel]="filterEntity()" (ngModelChange)="onFilterChange('entity', $event)">
            <option value="">All entities</option>
            @for (opt of entityOpts; track opt) {
              <option [value]="opt">{{ opt }}</option>
            }
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-zinc-700 font-medium">Actor username</label>
          <input type="text" class="input-field py-2 text-sm w-44" placeholder="Filter by actor"
                 [ngModel]="filterActor()" (ngModelChange)="onFilterChange('actor', $event)" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-zinc-700 font-medium">From date</label>
          <input type="date" class="input-field py-2 text-sm"
                 [ngModel]="filterFrom()" (ngModelChange)="onFilterChange('from', $event)" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-zinc-700 font-medium">To date</label>
          <input type="date" class="input-field py-2 text-sm"
                 [ngModel]="filterTo()" (ngModelChange)="onFilterChange('to', $event)" />
        </div>
        <button type="button" class="btn-secondary py-2 px-4 text-sm self-end"
                (click)="clearFilters()">
          Clear
        </button>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-2">
          @for (_ of skeletons; track $index) {
            <div class="card p-4 flex gap-4 items-center">
              <div class="shimmer h-4 w-24 rounded"></div>
              <div class="shimmer h-4 w-32 rounded ml-2"></div>
              <div class="shimmer h-4 w-20 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- Table -->
      @if (!loading() && logs().length > 0) {
        <div class="card overflow-hidden p-0">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-200 bg-zinc-50">
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider whitespace-nowrap">Timestamp</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Actor</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Entity</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Action</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Note</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-200">
                @for (log of logs(); track log.id) {
                  <tr [class]="'hover:bg-zinc-50 transition-colors' + (expandedId() === log.id ? ' bg-white/[0.01]' : '')">
                    <td class="px-4 py-3 text-xs text-zinc-700 whitespace-nowrap font-mono">
                      {{ formatTs(log.createdAt) }}
                    </td>
                    <td class="px-4 py-3">
                      @if (log.actorUsername) {
                        <span class="text-zinc-700 text-xs font-medium">{{ log.actorUsername }}</span>
                      } @else {
                        <span class="text-zinc-800 text-xs italic">system</span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase
                                     tracking-wider {{ entityBadge(log.entityType) }}">
                          {{ log.entityType }}
                        </span>
                        <code class="text-[10px] text-zinc-800 font-mono hidden lg:block">
                          {{ log.entityId.slice(0, 8) }}
                        </code>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <span class="text-xs text-zinc-700 font-medium">{{ log.action }}</span>
                    </td>
                    <td class="px-4 py-3 text-xs text-zinc-700 max-w-xs truncate">
                      {{ log.note ?? '—' }}
                    </td>
                    <td class="px-4 py-3">
                      @if (hasDiff(log)) {
                        <button type="button"
                                class="text-xs text-zinc-700 hover:text-zinc-700 transition-colors
                                       px-2 py-1 rounded border border-transparent hover:border-zinc-200
                                       whitespace-nowrap"
                                (click)="toggleExpand(log.id)">
                          {{ expandedId() === log.id ? 'Hide diff' : 'View diff' }}
                        </button>
                      }
                    </td>
                  </tr>

                  <!-- Expanded diff row -->
                  @if (expandedId() === log.id) {
                    <tr>
                      <td colspan="6" class="px-4 pb-4 pt-0">
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-1">
                          @if (log.before !== null && log.before !== undefined) {
                            <div class="rounded-xl bg-red-500/5 border border-red-500/15 overflow-hidden">
                              <div class="px-3 py-2 border-b border-red-500/10">
                                <p class="text-[10px] font-semibold uppercase tracking-wider text-red-400">Before</p>
                              </div>
                              <pre class="px-3 py-3 text-[11px] text-zinc-700 overflow-x-auto leading-relaxed font-mono max-h-48">{{ formatJson(log.before) }}</pre>
                            </div>
                          }
                          @if (log.after !== null && log.after !== undefined) {
                            <div class="rounded-xl bg-[#c4832a]/5 border border-amber-500/15 overflow-hidden">
                              <div class="px-3 py-2 border-b border-amber-500/10">
                                <p class="text-[10px] font-semibold uppercase tracking-wider text-[#c4832a]">After</p>
                              </div>
                              <pre class="px-3 py-3 text-[11px] text-zinc-700 overflow-x-auto leading-relaxed font-mono max-h-48">{{ formatJson(log.after) }}</pre>
                            </div>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="px-4 py-3 border-t border-zinc-200 flex items-center justify-between">
            <p class="text-xs text-zinc-700">
              Showing {{ offset() + 1 }}–{{ offset() + logs().length }} of {{ total() }}
            </p>
            <div class="flex items-center gap-2">
              <button type="button" class="btn-secondary py-1.5 px-3 text-xs"
                      [disabled]="offset() === 0" (click)="prevPage()">
                Previous
              </button>
              <button type="button" class="btn-secondary py-1.5 px-3 text-xs"
                      [disabled]="offset() + PAGE_SIZE >= total()" (click)="nextPage()">
                Next
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Empty -->
      @if (!loading() && logs().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-zinc-700">No audit log entries match the current filters.</p>
        </div>
      }
    </div>
  `,
})
export class AdminAuditLogComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly loading      = signal(true);
  readonly logs         = signal<AuditLog[]>([]);
  readonly total        = signal(0);
  readonly offset       = signal(0);
  readonly expandedId   = signal<string | null>(null);
  readonly filterEntity = signal('');
  readonly filterActor  = signal('');
  readonly filterFrom   = signal('');
  readonly filterTo     = signal('');

  readonly PAGE_SIZE = PAGE_SIZE;
  readonly skeletons = Array(8);

  readonly entityOpts = [
    'product', 'order', 'ticket', 'review', 'user', 'rule_set', 'banned_term', 'campaign',
  ];

  async ngOnInit(): Promise<void> { await this.load(); }

  onFilterChange(field: string, value: string): void {
    if (field === 'entity') this.filterEntity.set(value);
    else if (field === 'actor') this.filterActor.set(value);
    else if (field === 'from') this.filterFrom.set(value);
    else if (field === 'to') this.filterTo.set(value);
    this.offset.set(0);
    void this.load();
  }

  clearFilters(): void {
    this.filterEntity.set('');
    this.filterActor.set('');
    this.filterFrom.set('');
    this.filterTo.set('');
    this.offset.set(0);
    void this.load();
  }

  prevPage(): void { this.offset.set(Math.max(0, this.offset() - PAGE_SIZE)); void this.load(); }
  nextPage(): void { this.offset.set(this.offset() + PAGE_SIZE); void this.load(); }

  toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  hasDiff(log: AuditLog): boolean {
    return log.before !== null && log.before !== undefined
      || log.after !== null && log.after !== undefined;
  }

  entityBadge(type: string): string { return entityBadge(type); }

  formatTs(ts: string): string {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: 'short', timeStyle: 'medium',
    });
  }

  formatJson(val: unknown): string {
    try { return JSON.stringify(val, null, 2); } catch { return String(val); }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.expandedId.set(null);
    try {
      const params: Record<string, string | number | undefined> = {
        limit: PAGE_SIZE,
        offset: this.offset(),
      };
      if (this.filterEntity()) params['entityType']  = this.filterEntity();
      if (this.filterActor())  params['actor']        = this.filterActor();
      if (this.filterFrom())   params['from']         = this.filterFrom();
      if (this.filterTo())     params['to']           = this.filterTo();

      const res = await firstValueFrom(
        this.api.get<AuditLogListResponse>('/admin/audit-logs', params)
      );
      this.logs.set(res.data);
      this.total.set(res.total);
    } catch {
      this.logs.set([]);
      this.total.set(0);
    } finally {
      this.loading.set(false);
    }
  }
}
