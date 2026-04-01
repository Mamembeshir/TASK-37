import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

export type TermType = 'exact' | 'pattern';

export interface BannedTerm {
  id: string;
  term: string;
  type: TermType;
  isActive: boolean;
  createdAt: string;
  createdByUsername: string | null;
}

@Component({
  selector: 'app-admin-banned-terms',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900">Banned Terms</h1>
        <p class="text-sm text-zinc-700 mt-0.5">
          Manage the offline content moderation dictionary — exact words and regex patterns
        </p>
      </div>

      <!-- Add term panel -->
      <div class="card p-5 space-y-4">
        <h2 class="text-sm font-semibold text-zinc-700">Add new term or pattern</h2>

        @if (addError()) {
          <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10
                      border border-red-500/30 text-sm text-red-300">
            <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor"
                 stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            {{ addError() }}
          </div>
        }

        <div class="flex flex-col sm:flex-row gap-3">
          <!-- Type toggle -->
          <div class="flex rounded-xl overflow-hidden border border-zinc-200 shrink-0">
            <button type="button"
                    [class]="addType() === 'exact'
                      ? 'px-4 py-2 text-xs font-semibold bg-[#c4832a]/10 text-[#c4832a] border-r border-zinc-200 transition-colors'
                      : 'px-4 py-2 text-xs font-medium text-zinc-700 hover:text-zinc-700 border-r border-zinc-200 transition-colors bg-transparent'"
                    (click)="addType.set('exact')">
              Exact word
            </button>
            <button type="button"
                    [class]="addType() === 'pattern'
                      ? 'px-4 py-2 text-xs font-semibold bg-violet-500/20 text-violet-300 transition-colors'
                      : 'px-4 py-2 text-xs font-medium text-zinc-700 hover:text-zinc-700 transition-colors bg-transparent'"
                    (click)="addType.set('pattern')">
              Regex pattern
            </button>
          </div>

          <input type="text" class="input-field flex-1 py-2 text-sm font-mono"
                 [placeholder]="addType() === 'exact' ? 'e.g. badword' : 'e.g. bad\\s*word|offensive+'"
                 [(ngModel)]="addTerm"
                 (keydown.enter)="submit()" />

          <button type="button"
                  class="btn-primary py-2 px-5 text-sm flex items-center gap-2 shrink-0
                         disabled:opacity-50 disabled:cursor-not-allowed
                         disabled:transform-none disabled:shadow-none"
                  [disabled]="adding()"
                  (click)="submit()">
            @if (adding()) {
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10"
                        stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
            } @else {
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                   viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
            Add
          </button>
        </div>

        @if (addType() === 'pattern') {
          <p class="text-xs text-zinc-800">
            Patterns are matched case-insensitively against review text.
            Use standard regex syntax (e.g. <code class="font-mono text-zinc-700">bad\s*word</code>).
          </p>
        }
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-3">
        <input type="text" class="input-field w-52 py-2 text-sm" placeholder="Filter terms…"
               [ngModel]="filterQuery()" (ngModelChange)="filterQuery.set($event)" />
        <div class="flex rounded-xl overflow-hidden border border-zinc-200">
          @for (opt of typeOpts; track opt.value) {
            <button type="button"
                    [class]="filterType() === opt.value
                      ? 'px-3 py-2 text-xs font-semibold bg-white/10 text-zinc-800 border-r border-zinc-200 last:border-r-0 transition-colors'
                      : 'px-3 py-2 text-xs text-zinc-700 hover:text-zinc-700 border-r border-zinc-200 last:border-r-0 transition-colors bg-transparent'"
                    (click)="filterType.set(opt.value)">
              {{ opt.label }}
            </button>
          }
        </div>
      </div>

      <!-- Delete confirmation -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 bg-black/60 z-50 flex items-center
                    justify-center p-4 animate-fade-in">
          <div class="card max-w-sm w-full p-6 space-y-4 animate-scale-in">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-full bg-red-500/10 flex items-center
                          justify-center shrink-0">
                <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor"
                     stroke-width="1.75" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73
                           0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898
                           0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-semibold text-zinc-900">Remove banned term?</p>
                <p class="text-xs text-zinc-700 mt-1">
                  <code class="font-mono">{{ deleteTarget()!.term }}</code> will no longer be
                  checked during content moderation.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3 justify-end">
              <button type="button" class="btn-secondary py-2 px-4 text-sm"
                      (click)="deleteTarget.set(null)">
                Cancel
              </button>
              <button type="button"
                      class="py-2 px-4 text-sm font-semibold rounded-xl bg-red-500/10
                             border border-red-500/20 text-red-300 hover:bg-red-500/20
                             transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center gap-2"
                      [disabled]="deleting()"
                      (click)="confirmDelete()">
                @if (deleting()) {
                  <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                  Removing…
                } @else {
                  Remove
                }
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-2">
          @for (_ of skeletons; track $index) {
            <div class="card p-3.5 flex gap-4 items-center">
              <div class="shimmer h-4 w-48 rounded font-mono"></div>
              <div class="shimmer h-5 w-16 rounded ml-2"></div>
              <div class="shimmer h-4 w-24 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- List -->
      @if (!loading()) {
        @if (filtered().length === 0) {
          <div class="card p-10 text-center">
            <p class="text-zinc-700">No terms found.</p>
          </div>
        } @else {
          <div class="card overflow-hidden p-0">
            <div class="divide-y divide-zinc-200">
              @for (t of filtered(); track t.id) {
                <div class="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors group">
                  <!-- Type pill -->
                  <span [class]="t.type === 'exact'
                    ? 'text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider bg-[#c4832a]/10 text-[#c4832a] border border-[#c4832a]/20 shrink-0'
                    : 'text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20 shrink-0'">
                    {{ t.type }}
                  </span>

                  <!-- Term -->
                  <code class="font-mono text-sm text-zinc-800 flex-1 truncate">{{ t.term }}</code>

                  <!-- Meta -->
                  <span class="text-xs text-zinc-800 hidden sm:block whitespace-nowrap">
                    Added {{ formatDate(t.createdAt) }}
                    @if (t.createdByUsername) { · {{ t.createdByUsername }} }
                  </span>

                  <!-- Remove -->
                  <button type="button"
                          class="text-xs text-red-500 hover:text-red-300 transition-colors
                                 px-2 py-1 rounded border border-transparent
                                 hover:border-red-500/20 opacity-0 group-hover:opacity-100"
                          (click)="deleteTarget.set(t)">
                    Remove
                  </button>
                </div>
              }
            </div>
          </div>

          <p class="text-xs text-zinc-800 text-right">
            {{ filtered().length }} of {{ terms().length }} term{{ terms().length === 1 ? '' : 's' }}
          </p>
        }
      }
    </div>
  `,
})
export class AdminBannedTermsComponent implements OnInit {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading      = signal(true);
  readonly terms        = signal<BannedTerm[]>([]);
  readonly adding       = signal(false);
  readonly addError     = signal<string | null>(null);
  readonly addType      = signal<TermType>('exact');
  readonly deleteTarget = signal<BannedTerm | null>(null);
  readonly deleting     = signal(false);
  readonly filterQuery  = signal('');
  readonly filterType   = signal<TermType | ''>('');

  readonly filtered = computed(() => {
    let list = this.terms();
    const q = this.filterQuery().toLowerCase();
    if (q) list = list.filter(t => t.term.toLowerCase().includes(q));
    if (this.filterType()) list = list.filter(t => t.type === this.filterType());
    return list;
  });

  readonly typeOpts = [
    { value: '' as const, label: 'All' },
    { value: 'exact' as const, label: 'Exact' },
    { value: 'pattern' as const, label: 'Pattern' },
  ];
  readonly skeletons = Array(5);

  addTerm = '';

  async ngOnInit(): Promise<void> { await this.load(); }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  async submit(): Promise<void> {
    const term = this.addTerm.trim();
    if (!term) { this.addError.set('Enter a term or pattern.'); return; }
    if (this.addType() === 'pattern') {
      try { new RegExp(term); } catch {
        this.addError.set('Invalid regex — please check the pattern syntax.'); return;
      }
    }

    this.adding.set(true);
    this.addError.set(null);

    try {
      const t = await firstValueFrom(
        this.api.post<BannedTerm>('/admin/banned-terms', { term, type: this.addType() })
      );
      this.terms.update(list => [t, ...list]);
      this.addTerm = '';
      this.toast.success('Term added');
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status === 409) {
        this.addError.set('This term already exists.');
      } else {
        const msg: string = (e.error as { error?: string })?.error ?? 'Could not add term';
        this.addError.set(msg);
      }
    } finally {
      this.adding.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    const t = this.deleteTarget();
    if (!t) return;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.api.delete(`/admin/banned-terms/${t.id}`));
      this.terms.update(list => list.filter(x => x.id !== t.id));
      this.toast.success(`"${t.term}" removed`);
      this.deleteTarget.set(null);
    } catch {
      this.toast.error('Could not remove term');
    } finally {
      this.deleting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.get<BannedTerm[]>('/admin/banned-terms'));
      this.terms.set(res);
    } catch {
      this.terms.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
