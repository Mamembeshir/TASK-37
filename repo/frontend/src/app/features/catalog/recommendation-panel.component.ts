import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { ProductCardComponent } from './product-card.component';
import type { Product, CampaignMeta } from '../../core/models/product.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-recommendation-panel',
  standalone: true,
  imports: [ProductCardComponent],
  template: `
    <section class="space-y-4">

      <!-- Section header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-zinc-900">Featured Products</h2>
          @if (campaign()) {
            <p class="text-xs text-zinc-700 mt-0.5">{{ campaign()!.displayLabel }}</p>
          } @else {
            <p class="text-xs text-zinc-700 mt-0.5">Ranked by {{ strategyLabel() }}</p>
          }
        </div>

        <!-- A/B test banner -->
        @if (campaign()) {
          <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full
                      bg-violet-500/10 border border-violet-500/20 text-xs font-medium text-violet-300">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 1-6.23-.693L4.2 13.9m15.6 1.4-1.815 5.44M4.2 13.9l-1.815 5.44" />
            </svg>
            Test {{ campaign()!.variant }} active
          </div>
        }
      </div>

      <!-- Loading skeletons -->
      @if (loading()) {
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          @for (_ of skeletons; track $index) {
            <div class="card p-0 overflow-hidden">
              <div class="shimmer h-40"></div>
              <div class="p-4 space-y-3">
                <div class="shimmer h-3 w-1/2 rounded"></div>
                <div class="shimmer h-4 w-4/5 rounded"></div>
                <div class="shimmer h-4 w-3/5 rounded"></div>
                <div class="shimmer h-9 rounded-lg mt-2"></div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Products -->
      @if (!loading() && products().length > 0) {
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          @for (p of products(); track p.id) {
            <app-product-card [product]="p" />
          }
        </div>
      }

      <!-- Empty -->
      @if (!loading() && products().length === 0) {
        <p class="text-zinc-700 text-sm py-4">No featured products available.</p>
      }
    </section>
  `,
})
export class RecommendationPanelComponent implements OnInit {
  private readonly productSvc = inject(ProductService);

  readonly loading   = signal(true);
  readonly products  = signal<Product[]>([]);
  readonly campaign  = signal<CampaignMeta | null>(null);
  readonly strategy  = signal<string>('newest');
  readonly skeletons = Array(4);

  protected strategyLabel(): string {
    const map: Record<string, string> = {
      popularity: 'popularity', price_asc: 'lowest price', price_desc: 'highest price',
      newest: 'newest', manual: 'curated order',
    };
    return map[this.strategy()] ?? this.strategy();
  }

  async ngOnInit(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.productSvc.getRecommendations(environment.storeId, 8),
      );
      this.products.set(res.data);
      this.campaign.set(res.campaign);
      this.strategy.set(res.strategy);
    } finally {
      this.loading.set(false);
    }
  }
}
