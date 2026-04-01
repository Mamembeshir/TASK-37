import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ReviewService } from '../../core/services/review.service';
import { OrderService } from '../../core/services/order.service';
import { ToastService } from '../../core/services/toast.service';
import { ReviewFormComponent } from './review-form.component';
import { ReviewListComponent } from './review-list.component';
import { FollowUpReviewComponent } from './followup-review.component';
import type { Review } from '../../core/models/review.model';
import type { OrderDetail } from '../../core/models/order.model';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE } from '../../core/models/order.model';

@Component({
  selector: 'app-reviews-page',
  standalone: true,
  imports: [
    RouterLink,
    ReviewFormComponent,
    ReviewListComponent,
    FollowUpReviewComponent,
  ],
  template: `
    <div class="max-w-2xl mx-auto px-4 sm:px-6 py-8 animate-fade-in space-y-6">

      <!-- Breadcrumb -->
      <div class="flex items-center gap-1.5 text-xs text-zinc-700">
        <a routerLink="/orders" class="hover:text-zinc-700 transition-colors">Orders</a>
        <span class="text-zinc-700">/</span>
        <span class="truncate max-w-[140px] font-mono">
          {{ orderId().slice(0, 8).toUpperCase() }}…
        </span>
        <span class="text-zinc-700">/</span>
        <span>Reviews</span>
      </div>

      <!-- Page header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900 tracking-tight">Reviews</h1>
          <p class="mt-1 text-sm text-zinc-700">
            Share your experience or view existing reviews for this order.
          </p>
        </div>
        @if (order()) {
          <span class="badge border text-[10px] px-2.5 py-1 shrink-0
                       {{ statusBadge(order()!.status) }}">
            {{ statusLabel(order()!.status) }}
          </span>
        }
      </div>

      <!-- Loading state -->
      @if (loading()) {
        <div class="space-y-4">
          @for (i of [1, 2]; track i) {
            <div class="glass rounded-2xl border border-zinc-200 p-6 space-y-3 animate-pulse">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-zinc-800"></div>
                <div class="space-y-1.5">
                  <div class="h-3 w-24 bg-zinc-800 rounded"></div>
                  <div class="h-2.5 w-16 bg-zinc-100 rounded"></div>
                </div>
              </div>
              <div class="space-y-2">
                <div class="h-3 bg-zinc-800 rounded w-full"></div>
                <div class="h-3 bg-zinc-800 rounded w-4/5"></div>
                <div class="h-3 bg-zinc-800 rounded w-3/5"></div>
              </div>
            </div>
          }
        </div>
      }

      @if (!loading() && !loadError()) {

        <!-- Order not picked up — cannot review yet -->
        @if (order() && order()!.status !== 'picked_up') {
          <div class="glass rounded-2xl border border-amber-500/15 p-5
                      flex items-start gap-3">
            <svg class="w-5 h-5 text-[#c4832a] shrink-0 mt-0.5" fill="none"
                 stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div>
              <p class="text-sm font-medium text-[#c4832a]">Reviews are not available yet</p>
              <p class="text-xs text-zinc-700 mt-0.5">
                You can only review an order after it has been picked up.
                Current status: <span class="text-zinc-700">{{ statusLabel(order()!.status) }}</span>.
              </p>
            </div>
          </div>
        }

        <!-- No original review — show review form -->
        @if (order()?.status === 'picked_up' && !originalReview()) {
          <app-review-form
            [orderId]="orderId()"
            (submitted)="onReviewSubmitted($event)"
          />
        }

        <!-- Has original review, no followup yet, within 14 days — show followup form -->
        @if (originalReview() && !followupReview()) {
          <app-followup-review
            [parentReview]="originalReview()!"
            (submitted)="onFollowupSubmitted($event)"
          />
        }

        <!-- Has follow-up already -->
        @if (followupReview()) {
          <div class="flex items-center gap-2 px-4 py-3 rounded-xl
                      bg-zinc-800/40 border border-zinc-200">
            <svg class="w-4 h-4 text-zinc-800 shrink-0" fill="none" stroke="currentColor"
                 stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <p class="text-xs text-zinc-700">
              You have already submitted a follow-up review for this order.
            </p>
          </div>
        }

        <!-- Review list (always visible when reviews exist) -->
        @if (reviews().length > 0) {
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold text-zinc-700 uppercase tracking-wider">
                {{ reviews().length }} Review{{ reviews().length === 1 ? '' : 's' }}
              </h2>
            </div>
            <app-review-list [reviews]="reviews()" />
          </div>
        }

      }
    </div>
  `,
})
export class ReviewsPageComponent implements OnInit {
  private readonly route     = inject(ActivatedRoute);
  private readonly reviewSvc = inject(ReviewService);
  private readonly orderSvc  = inject(OrderService);
  private readonly toast     = inject(ToastService);

  readonly orderId  = signal('');
  readonly order    = signal<OrderDetail | null>(null);
  readonly reviews  = signal<Review[]>([]);
  readonly loading  = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly originalReview = computed(() =>
    this.reviews().find((r) => !r.isFollowup) ?? null,
  );
  readonly followupReview = computed(() =>
    this.reviews().find((r) => r.isFollowup) ?? null,
  );

  statusLabel(s: string): string { return ORDER_STATUS_LABEL[s] ?? s; }
  statusBadge(s: string): string { return ORDER_STATUS_BADGE[s] ?? ''; }

  ngOnInit(): void {
    this.orderId.set(this.route.snapshot.paramMap.get('id') ?? '');
    void this.loadData();
  }

  async loadData(): Promise<void> {
    if (!this.orderId()) return;
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const [order, reviews] = await Promise.all([
        firstValueFrom(this.orderSvc.getOrder(this.orderId())),
        firstValueFrom(this.reviewSvc.list(this.orderId())),
      ]);
      this.order.set(order);
      this.reviews.set(reviews);
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg = e.status === 404 ? 'Order not found.' : 'Could not load reviews. Please try again.';
      this.loadError.set(msg);
      this.toast.error(msg);
    } finally {
      this.loading.set(false);
    }
  }

  onReviewSubmitted(review: Review): void {
    this.reviews.update((prev) => [review, ...prev]);
  }

  onFollowupSubmitted(review: Review): void {
    this.reviews.update((prev) => [review, ...prev]);
  }
}
