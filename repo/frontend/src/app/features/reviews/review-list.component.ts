import { Component, Input } from '@angular/core';
import {
  type Review,
  type ModerationStatus,
  MODERATION_LABEL,
  MODERATION_BADGE,
  MODERATION_ICON,
  formatBytes,
} from '../../core/models/review.model';

@Component({
  selector: 'app-review-list',
  standalone: true,
  template: `
    @if (reviews.length === 0) {
      <div class="text-center py-10 space-y-2">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl
                    bg-zinc-100 border border-zinc-200 mb-2">
          <svg class="w-5.5 h-5.5 text-zinc-800" fill="none" stroke="currentColor"
               stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
          </svg>
        </div>
        <p class="text-sm text-zinc-700">No reviews yet for this order.</p>
      </div>
    } @else {
      <div class="space-y-4">
        @for (review of reviews; track review.id) {
          <div class="glass rounded-2xl border p-5 space-y-4 transition-colors"
               [class]="review.isFollowup
                 ? 'border-violet-500/15 bg-violet-500/[0.02]'
                 : 'border-zinc-200'">

            <!-- Review header -->
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <!-- Avatar placeholder -->
                <div class="w-8 h-8 rounded-full bg-zinc-700/50 border border-zinc-200
                            flex items-center justify-center shrink-0">
                  <svg class="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor"
                       stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </div>
                <div>
                  @if (review.isFollowup) {
                    <span class="text-xs font-medium text-violet-300">Follow-up Review</span>
                  } @else {
                    <span class="text-xs font-medium text-zinc-700">Original Review</span>
                  }
                  <p class="text-[10px] text-zinc-800">
                    {{ formatDate(review.submittedAt) }}
                  </p>
                </div>
              </div>

              <!-- Moderation status badge (task 179) -->
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                           text-[10px] font-semibold shrink-0
                           {{ moderationBadge(review.moderationStatus) }}">
                <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor"
                     stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    [attr.d]="moderationIcon(review.moderationStatus)" />
                </svg>
                {{ moderationLabel(review.moderationStatus) }}
              </span>
            </div>

            <!-- Review body -->
            @if (review.moderationStatus === 'flagged') {
              <div class="px-3 py-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
                <p class="text-xs text-red-400/80 italic">
                  This review has been flagged and is pending moderation review.
                </p>
              </div>
            } @else {
              <p class="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                {{ review.body }}
              </p>
            }

            <!-- Images -->
            @if (review.images.length > 0) {
              <div class="space-y-2">
                <p class="text-[10px] font-medium text-zinc-800 uppercase tracking-wider">
                  {{ review.images.length }} Image{{ review.images.length === 1 ? '' : 's' }}
                </p>
                <div class="flex flex-wrap gap-2">
                  @for (img of review.images; track img.id) {
                    <div class="relative group flex items-center gap-2 px-2.5 py-1.5 rounded-lg
                                bg-zinc-50 border border-zinc-200 max-w-[200px]">
                      <!-- File icon -->
                      <svg class="w-4 h-4 text-zinc-700 shrink-0" fill="none"
                           stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round"
                          d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                      </svg>
                      <div class="min-w-0">
                        <p class="text-[10px] text-zinc-700 truncate max-w-[120px]">
                          {{ img.originalName }}
                        </p>
                        <p class="text-[9px] text-zinc-800">{{ formatBytes(img.sizeBytes) }}</p>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ReviewListComponent {
  @Input({ required: true }) reviews!: Review[];

  readonly formatBytes = formatBytes;

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  moderationLabel(status: ModerationStatus): string {
    return MODERATION_LABEL[status] ?? status;
  }

  moderationBadge(status: ModerationStatus): string {
    return MODERATION_BADGE[status] ?? '';
  }

  moderationIcon(status: ModerationStatus): string {
    return MODERATION_ICON[status] ?? '';
  }
}
