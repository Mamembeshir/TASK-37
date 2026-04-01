import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

export type RuleSetStatus = 'draft' | 'published' | 'archived';

export interface RuleSet {
  id: string;
  name: string;
  description: string | null;
  version: number;
  status: RuleSetStatus;
  comment: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGE: Record<RuleSetStatus, string> = {
  draft:     'bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]',
  published: 'bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]',
  archived:  'bg-zinc-500/10 border border-zinc-500/20 text-zinc-700',
};

const STATUS_LABEL: Record<RuleSetStatus, string> = {
  draft:     'Draft',
  published: 'Published',
  archived:  'Archived',
};

@Component({
  selector: 'app-admin-rules',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900">Rules Engine</h1>
        <p class="text-sm text-zinc-700 mt-0.5">
          Manage versioned rule sets — publish or roll back to restore a prior version
        </p>
      </div>

      <!-- Publish / Rollback modal -->
      @if (modalTarget()) {
        <div class="fixed inset-0 bg-black/60 z-50 flex items-center
                    justify-center p-4 animate-fade-in">
          <div class="card max-w-md w-full p-6 space-y-4 animate-scale-in">
            <h2 class="text-base font-semibold text-zinc-900">
              {{ modalAction() === 'publish' ? 'Publish rule set' : 'Roll back rule set' }}
            </h2>
            <p class="text-sm text-zinc-700">
              @if (modalAction() === 'publish') {
                Publishing <span class="text-zinc-800 font-medium">{{ modalTarget()!.name }}</span>
                v{{ modalTarget()!.version }} will make it the active rule set immediately.
              } @else {
                Rolling back will restore the previous published version of
                <span class="text-zinc-800 font-medium">{{ modalTarget()!.name }}</span>.
                The current version will be archived.
              }
            </p>

            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">
                Admin comment <span class="text-red-400">*</span>
              </label>
              <textarea class="input-field text-sm resize-none" rows="3"
                        placeholder="Describe why you are making this change…"
                        [(ngModel)]="modalComment"></textarea>
            </div>

            @if (modalError()) {
              <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10
                          border border-red-500/30 text-sm text-red-300">
                <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor"
                     stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {{ modalError() }}
              </div>
            }

            <div class="flex items-center gap-3 justify-end">
              <button type="button" class="btn-secondary py-2 px-4 text-sm"
                      [disabled]="acting()" (click)="closeModal()">
                Cancel
              </button>
              <button type="button"
                      [class]="modalAction() === 'publish'
                        ? 'btn-primary py-2 px-5 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none'
                        : 'py-2 px-5 text-sm font-semibold rounded-xl bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a] hover:bg-[#c4832a]/10 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed'"
                      [disabled]="acting()"
                      (click)="confirmModal()">
                @if (acting()) {
                  <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                }
                {{ modalAction() === 'publish' ? 'Publish' : 'Roll back' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-3">
          @for (_ of skeletons; track $index) {
            <div class="card p-5 flex gap-4 items-center">
              <div class="shimmer h-4 w-40 rounded"></div>
              <div class="shimmer h-4 w-20 rounded ml-4"></div>
              <div class="shimmer h-4 w-16 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- Rule sets list -->
      @if (!loading() && ruleSets().length > 0) {
        <div class="space-y-3">
          @for (r of ruleSets(); track r.id) {
            <div class="card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <!-- Left: name + meta -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="font-semibold text-zinc-900 text-sm">{{ r.name }}</p>
                  <span class="font-mono text-xs text-zinc-800">v{{ r.version }}</span>
                  <span class="text-[11px] px-2 py-0.5 rounded-full font-medium {{ statusBadge(r.status) }}">
                    {{ statusLabel(r.status) }}
                  </span>
                </div>
                @if (r.description) {
                  <p class="text-xs text-zinc-700 mt-1 truncate">{{ r.description }}</p>
                }
                @if (r.publishedAt) {
                  <p class="text-xs text-zinc-800 mt-1">
                    Published {{ formatDate(r.publishedAt) }}
                    @if (r.comment) {
                      · <span class="italic text-zinc-700">"{{ r.comment }}"</span>
                    }
                  </p>
                }
              </div>

              <!-- Right: actions -->
              <div class="flex items-center gap-2 shrink-0">
                @if (r.status === 'draft') {
                  <button type="button"
                          class="btn-primary py-1.5 px-4 text-xs flex items-center gap-1.5"
                          (click)="openModal(r, 'publish')">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                         stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0
                               0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                    </svg>
                    Publish
                  </button>
                }
                @if (r.status === 'published' && r.version > 1) {
                  <button type="button"
                          class="py-1.5 px-4 text-xs font-semibold rounded-xl
                                 bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]
                                 hover:bg-[#c4832a]/10 transition-colors flex items-center gap-1.5"
                          (click)="openModal(r, 'rollback')">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                         stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                            d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                    </svg>
                    Roll back
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- Empty -->
      @if (!loading() && ruleSets().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-zinc-700">No rule sets found.</p>
        </div>
      }
    </div>
  `,
})
export class AdminRulesComponent implements OnInit {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading    = signal(true);
  readonly ruleSets   = signal<RuleSet[]>([]);
  readonly acting     = signal(false);
  readonly modalTarget = signal<RuleSet | null>(null);
  readonly modalAction = signal<'publish' | 'rollback'>('publish');
  readonly modalError  = signal<string | null>(null);

  readonly skeletons = Array(4);
  modalComment = '';

  async ngOnInit(): Promise<void> { await this.load(); }

  statusBadge(s: RuleSetStatus): string { return STATUS_BADGE[s]; }
  statusLabel(s: RuleSetStatus): string { return STATUS_LABEL[s]; }
  formatDate(d: string): string {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  openModal(r: RuleSet, action: 'publish' | 'rollback'): void {
    this.modalTarget.set(r);
    this.modalAction.set(action);
    this.modalComment = '';
    this.modalError.set(null);
  }

  closeModal(): void { this.modalTarget.set(null); this.modalError.set(null); }

  async confirmModal(): Promise<void> {
    if (!this.modalComment.trim()) {
      this.modalError.set('An admin comment is required before proceeding.');
      return;
    }
    const r = this.modalTarget();
    if (!r) return;

    this.acting.set(true);
    this.modalError.set(null);

    const endpoint = this.modalAction() === 'publish'
      ? `/admin/rules/${r.id}/publish`
      : `/admin/rules/${r.id}/rollback`;

    try {
      await firstValueFrom(this.api.post(endpoint, { comment: this.modalComment.trim() }));
      this.toast.success(
        this.modalAction() === 'publish'
          ? `"${r.name}" published`
          : `"${r.name}" rolled back to previous version`
      );
      this.closeModal();
      await this.load();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg: string = (e.error as { error?: string })?.error ?? 'Action failed';
      this.modalError.set(msg);
    } finally {
      this.acting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.get<RuleSet[]>('/admin/rules'));
      this.ruleSets.set(res);
    } catch {
      this.ruleSets.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
