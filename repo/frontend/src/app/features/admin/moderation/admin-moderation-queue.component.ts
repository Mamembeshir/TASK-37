import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import type { ModerationStatus } from '../../../core/models/review.model';
import { MODERATION_BADGE, MODERATION_LABEL } from '../../../core/models/review.model';

export interface ModerationItem {
  id: string;
  orderId: string;
  customerId: string;
  body: string;
  isFollowup: boolean;
  moderationStatus: ModerationStatus;
  flagReason: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  resolvedByUsername: string | null;
  resolvedNote: string | null;
  imageCount: number;
}

type ActionType = 'approve' | 'reject';

@Component({
  selector: 'app-admin-moderation-queue',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900">Moderation Queue</h1>
          <p class="text-sm text-zinc-700 mt-0.5">
            Review flagged content — approve to publish or reject with an audit note
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (pendingCount() > 0) {
            <span class="text-xs px-2.5 py-1 rounded-full font-semibold
                         bg-[#c4832a]/10 border border-[#c4832a]/20 text-[#c4832a]">
              {{ pendingCount() }} pending
            </span>
          }
          <button type="button" class="btn-secondary py-2 px-3 text-sm flex items-center gap-1.5"
                  [disabled]="loading()" (click)="load()">
            <svg class="w-3.5 h-3.5" [class.animate-spin]="loading()"
                 fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0
                       2.181 2.183a8.959 8.959 0 0 0 12.542 0 8.96 8.96 0 0
                       0-2.181-12.542m0 0-2.181 2.183" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- Status filter tabs -->
      <div class="flex gap-1 border-b border-zinc-200">
        @for (tab of tabs; track tab.value) {
          <button type="button"
                  [class]="filterStatus() === tab.value
                    ? 'px-4 py-2.5 text-sm font-semibold text-zinc-900 border-b-2 border-[#c4832a] -mb-px transition-colors'
                    : 'px-4 py-2.5 text-sm text-zinc-700 hover:text-zinc-700 border-b-2 border-transparent -mb-px transition-colors'"
                  (click)="filterStatus.set(tab.value)">
            {{ tab.label }}
            @if (tab.value === 'pending' && pendingCount() > 0) {
              <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full
                           bg-[#c4832a]/10 text-[#c4832a] font-bold">
                {{ pendingCount() }}
              </span>
            }
          </button>
        }
      </div>

      <!-- Action modal -->
      @if (actionTarget()) {
        <div class="fixed inset-0 bg-black/60 z-50 flex items-center
                    justify-center p-4 animate-fade-in">
          <div class="card max-w-lg w-full p-6 space-y-4 animate-scale-in">
            <div class="flex items-center gap-3">
              <div [class]="actionType() === 'approve'
                ? 'w-9 h-9 rounded-full bg-[#c4832a]/10 flex items-center justify-center shrink-0'
                : 'w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center shrink-0'">
                @if (actionType() === 'approve') {
                  <svg class="w-4 h-4 text-[#c4832a]" fill="none" stroke="currentColor"
                       stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                } @else {
                  <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor"
                       stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                }
              </div>
              <h2 class="text-base font-semibold text-zinc-900">
                {{ actionType() === 'approve' ? 'Approve review' : 'Reject review' }}
              </h2>
            </div>

            <!-- Preview -->
            <div class="rounded-xl bg-white/[0.03] border border-zinc-200 p-4 space-y-2">
              <p class="text-xs text-zinc-700 font-medium">Review excerpt</p>
              <p class="text-sm text-zinc-700 line-clamp-4 leading-relaxed">
                {{ actionTarget()!.body }}
              </p>
              @if (actionTarget()!.flagReason) {
                <p class="text-xs text-[#c4832a] mt-1">
                  Flag reason: {{ actionTarget()!.flagReason }}
                </p>
              }
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">
                Audit note
                @if (actionType() === 'reject') {
                  <span class="text-red-400"> *</span>
                }
              </label>
              <textarea class="input-field text-sm resize-none" rows="3"
                        [placeholder]="actionType() === 'approve'
                          ? 'Optional note about why this was approved…'
                          : 'Explain why this content is being rejected…'"
                        [(ngModel)]="actionNote"></textarea>
            </div>

            @if (actionError()) {
              <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10
                          border border-red-500/30 text-sm text-red-300">
                <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor"
                     stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {{ actionError() }}
              </div>
            }

            <div class="flex items-center gap-3 justify-end">
              <button type="button" class="btn-secondary py-2 px-4 text-sm"
                      [disabled]="acting()" (click)="closeAction()">
                Cancel
              </button>
              <button type="button"
                      [class]="actionType() === 'approve'
                        ? 'btn-primary py-2 px-5 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none'
                        : 'py-2 px-5 text-sm font-semibold rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed'"
                      [disabled]="acting()"
                      (click)="confirmAction()">
                @if (acting()) {
                  <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                }
                {{ actionType() === 'approve' ? 'Approve' : 'Reject' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-3">
          @for (_ of skeletons; track $index) {
            <div class="card p-5 space-y-3">
              <div class="flex gap-3">
                <div class="shimmer h-4 w-32 rounded"></div>
                <div class="shimmer h-4 w-20 rounded ml-2"></div>
              </div>
              <div class="shimmer h-12 w-full rounded"></div>
              <div class="shimmer h-4 w-24 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- Items -->
      @if (!loading()) {
        @if (filtered().length === 0) {
          <div class="card p-12 text-center space-y-2">
            <svg class="w-10 h-10 mx-auto text-zinc-700" fill="none" stroke="currentColor"
                 stroke-width="1.25" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <p class="text-zinc-700 text-sm">No items in this category.</p>
          </div>
        } @else {
          <div class="space-y-3">
            @for (item of filtered(); track item.id) {
              <div class="card p-5 space-y-3 hover:border-white/12 transition-colors">
                <!-- Top row: badges + meta -->
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[11px] px-2 py-0.5 rounded-full font-medium
                                 {{ moderationBadge(item.moderationStatus) }}">
                      {{ moderationLabel(item.moderationStatus) }}
                    </span>
                    @if (item.isFollowup) {
                      <span class="text-[11px] px-2 py-0.5 rounded-full font-medium
                                   bg-violet-500/10 border border-violet-500/20 text-violet-300">
                        Follow-up
                      </span>
                    }
                    @if (item.imageCount > 0) {
                      <span class="text-xs text-zinc-700 flex items-center gap-1">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                             stroke-width="1.75" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round"
                                d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159
                                   5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909
                                   2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0
                                   0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5
                                   1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1
                                   1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                        {{ item.imageCount }} image{{ item.imageCount === 1 ? '' : 's' }}
                      </span>
                    }
                    @if (item.flagReason) {
                      <span class="text-xs text-[#c4832a]">
                        Flag: {{ item.flagReason }}
                      </span>
                    }
                  </div>
                  <p class="text-xs text-zinc-800">
                    Order <code class="font-mono text-zinc-700">{{ item.orderId.slice(0, 8) }}</code>
                    · {{ formatDate(item.submittedAt) }}
                  </p>
                </div>

                <!-- Body preview -->
                <p class="text-sm text-zinc-700 leading-relaxed line-clamp-3">
                  {{ item.body }}
                </p>

                <!-- Resolution info (resolved items) -->
                @if (item.resolvedAt) {
                  <div class="rounded-lg bg-white/[0.03] border border-zinc-200 px-3 py-2
                              flex items-start gap-2">
                    <svg class="w-3.5 h-3.5 mt-0.5 text-zinc-700 shrink-0" fill="none"
                         stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                            d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75
                               .75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1
                               18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                    </svg>
                    <div class="text-xs text-zinc-700 leading-relaxed">
                      Resolved {{ formatDate(item.resolvedAt) }}
                      @if (item.resolvedByUsername) {
                        by <span class="text-zinc-700">{{ item.resolvedByUsername }}</span>
                      }
                      @if (item.resolvedNote) {
                        · <span class="italic">"{{ item.resolvedNote }}"</span>
                      }
                    </div>
                  </div>
                }

                <!-- Actions (pending items only) -->
                @if (item.moderationStatus === 'pending' || item.moderationStatus === 'flagged') {
                  <div class="flex items-center gap-3 pt-1">
                    <button type="button"
                            class="btn-primary py-1.5 px-4 text-xs flex items-center gap-1.5"
                            (click)="openAction(item, 'approve')">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                           stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round"
                              d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      Approve
                    </button>
                    <button type="button"
                            class="py-1.5 px-4 text-xs font-semibold rounded-xl
                                   bg-red-500/10 border border-red-500/20 text-red-300
                                   hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
                            (click)="openAction(item, 'reject')">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                           stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round"
                              d="M6 18 18 6M6 6l12 12" />
                      </svg>
                      Reject
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class AdminModerationQueueComponent implements OnInit {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading      = signal(true);
  readonly items        = signal<ModerationItem[]>([]);
  readonly filterStatus = signal<ModerationStatus | ''>('pending');
  readonly actionTarget = signal<ModerationItem | null>(null);
  readonly actionType   = signal<ActionType>('approve');
  readonly actionError  = signal<string | null>(null);
  readonly acting       = signal(false);

  readonly pendingCount = computed(() =>
    this.items().filter(i => i.moderationStatus === 'pending' || i.moderationStatus === 'flagged').length
  );

  readonly filtered = computed(() => {
    const s = this.filterStatus();
    return s ? this.items().filter(i => i.moderationStatus === s) : this.items();
  });

  readonly tabs = [
    { value: 'pending' as const, label: 'Pending' },
    { value: 'flagged' as const, label: 'Flagged' },
    { value: 'approved' as const, label: 'Approved' },
    { value: '' as const, label: 'All' },
  ];
  readonly skeletons = Array(4);

  actionNote = '';

  async ngOnInit(): Promise<void> { await this.load(); }

  moderationBadge(s: ModerationStatus): string { return MODERATION_BADGE[s]; }
  moderationLabel(s: ModerationStatus): string { return MODERATION_LABEL[s]; }
  formatDate(d: string): string {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  openAction(item: ModerationItem, type: ActionType): void {
    this.actionTarget.set(item);
    this.actionType.set(type);
    this.actionNote = '';
    this.actionError.set(null);
  }

  closeAction(): void { this.actionTarget.set(null); this.actionError.set(null); }

  async confirmAction(): Promise<void> {
    if (this.actionType() === 'reject' && !this.actionNote.trim()) {
      this.actionError.set('A rejection note is required for audit purposes.'); return;
    }
    const item = this.actionTarget();
    if (!item) return;

    this.acting.set(true);
    this.actionError.set(null);

    const endpoint = this.actionType() === 'approve'
      ? `/admin/moderation/${item.id}/approve`
      : `/admin/moderation/${item.id}/reject`;

    try {
      const updated = await firstValueFrom(
        this.api.post<ModerationItem>(endpoint, { note: this.actionNote.trim() || null })
      );
      this.items.update(list => list.map(i => i.id === updated.id ? updated : i));
      this.toast.success(
        this.actionType() === 'approve' ? 'Review approved and published' : 'Review rejected'
      );
      this.closeAction();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg: string = (e.error as { error?: string })?.error ?? 'Action failed';
      this.actionError.set(msg);
    } finally {
      this.acting.set(false);
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.api.get<ModerationItem[]>('/admin/moderation', { limit: 100, offset: 0 })
      );
      this.items.set(res);
    } catch {
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
