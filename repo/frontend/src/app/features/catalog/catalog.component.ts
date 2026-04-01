import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  untracked,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ProductService } from '../../core/services/product.service';
import { ProductCardComponent } from './product-card.component';
import { RecommendationPanelComponent } from './recommendation-panel.component';
import type { Product, SortValue } from '../../core/models/product.model';
import { SORT_OPTIONS } from '../../core/models/product.model';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [FormsModule, ProductCardComponent, RecommendationPanelComponent],
  template: `
    <div class="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header row -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-4">
        <div class="flex-1">
          <h1 class="text-2xl font-bold text-zinc-900">Catalog</h1>
          @if (!loading() && !hasFilters()) {
            <p class="text-sm text-zinc-700 mt-0.5">{{ total() }} products available</p>
          } @else if (!loading()) {
            <p class="text-sm text-zinc-700 mt-0.5">{{ total() }} result{{ total() === 1 ? '' : 's' }} found</p>
          }
        </div>

        <!-- Search -->
        <div class="relative flex-1 sm:max-w-sm">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-700 pointer-events-none"
               fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            class="input-field pl-9 py-2.5 text-sm"
            placeholder="Search products…"
            [ngModel]="searchRaw()"
            (ngModelChange)="onSearchInput($event)"
          />
        </div>

        <!-- Sort -->
        <select
          class="input-field w-auto py-2.5 text-sm cursor-pointer"
          [ngModel]="sortBy()"
          (ngModelChange)="onSortChange($event)"
        >
          @for (opt of sortOptions; track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>
      </div>

      <!-- Filters row -->
      <div class="flex flex-wrap items-end gap-3 p-4 glass rounded-xl">
        <!-- Brand -->
        <div class="flex flex-col gap-1 min-w-[140px]">
          <label class="text-xs text-zinc-700 font-medium">Brand</label>
          <input
            type="text"
            class="input-field py-2 text-sm"
            placeholder="Any brand"
            [ngModel]="brand()"
            (ngModelChange)="onBrandChange($event)"
          />
        </div>

        <!-- Min price -->
        <div class="flex flex-col gap-1 w-28">
          <label class="text-xs text-zinc-700 font-medium">Min price</label>
          <input
            type="number"
            class="input-field py-2 text-sm"
            placeholder="0"
            min="0"
            [ngModel]="minPriceRaw()"
            (ngModelChange)="onMinPriceChange($event)"
          />
        </div>

        <!-- Max price -->
        <div class="flex flex-col gap-1 w-28">
          <label class="text-xs text-zinc-700 font-medium">Max price</label>
          <input
            type="number"
            class="input-field py-2 text-sm"
            placeholder="Any"
            min="0"
            [ngModel]="maxPriceRaw()"
            (ngModelChange)="onMaxPriceChange($event)"
          />
        </div>

        <!-- In stock toggle -->
        <label class="flex items-center gap-2 cursor-pointer pb-1 select-none">
          <div class="relative inline-flex">
            <input
              type="checkbox"
              class="sr-only peer"
              [ngModel]="available()"
              (ngModelChange)="onAvailableChange($event)"
            />
            <div class="w-9 h-5 rounded-full border border-zinc-200 bg-zinc-800
                        peer-checked:bg-[#a86e22] peer-checked:border-[#c4832a]
                        transition-colors relative">
              <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-zinc-400
                          peer-checked:left-4 transition-all
                          group-has-[:checked]:left-4"></div>
            </div>
          </div>
          <span class="text-xs text-zinc-700 font-medium whitespace-nowrap">In stock only</span>
        </label>

        <!-- Clear filters -->
        @if (hasFilters()) {
          <button
            type="button"
            class="ml-auto text-xs text-zinc-700 hover:text-zinc-700 transition-colors
                   flex items-center gap-1.5 pb-1"
            (click)="clearFilters()"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
            Clear filters
          </button>
        }
      </div>

      <!-- Recommendation panel — only when no search/filters active -->
      @if (!hasFilters()) {
        <app-recommendation-panel />
        <hr class="border-zinc-200" />
        <h2 class="text-base font-semibold text-zinc-700">All Products</h2>
      }

      <!-- Loading skeletons -->
      @if (loading()) {
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          @for (_ of skeletons; track $index) {
            <div class="card p-0 overflow-hidden">
              <div class="shimmer h-40"></div>
              <div class="p-4 space-y-3">
                <div class="shimmer h-3 w-1/2 rounded"></div>
                <div class="shimmer h-4 w-4/5 rounded"></div>
                <div class="shimmer h-5 w-1/3 rounded mt-1"></div>
                <div class="shimmer h-9 rounded-lg mt-2"></div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Product grid -->
      @if (!loading() && products().length > 0) {
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
          @for (p of products(); track p.id) {
            <app-product-card [product]="p" />
          }
        </div>
      }

      <!-- Empty state -->
      @if (!loading() && products().length === 0) {
        <div class="card p-12 text-center animate-fade-in">
          <svg class="w-12 h-12 text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <p class="text-zinc-700 font-medium">No products found</p>
          @if (hasFilters()) {
            <p class="text-zinc-800 text-sm mt-1">Try adjusting your filters</p>
            <button type="button" class="btn-secondary mt-4 py-2 px-4 text-sm" (click)="clearFilters()">
              Clear filters
            </button>
          }
        </div>
      }

      <!-- Pagination -->
      @if (!loading() && total() > PAGE_SIZE) {
        <div class="flex items-center justify-between pt-2">
          <p class="text-sm text-zinc-700">
            Showing {{ offset() + 1 }}–{{ min(offset() + PAGE_SIZE, total()) }}
            of {{ total() }}
          </p>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn-secondary py-2 px-3 text-sm flex items-center gap-1.5
                     disabled:opacity-30 disabled:cursor-not-allowed"
              [disabled]="offset() === 0"
              (click)="prevPage()"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Prev
            </button>

            <span class="text-sm text-zinc-700 px-2">
              {{ currentPage() }} / {{ pageCount() }}
            </span>

            <button
              type="button"
              class="btn-secondary py-2 px-3 text-sm flex items-center gap-1.5
                     disabled:opacity-30 disabled:cursor-not-allowed"
              [disabled]="offset() + PAGE_SIZE >= total()"
              (click)="nextPage()"
            >
              Next
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class CatalogComponent implements OnInit, OnDestroy {
  private readonly productSvc = inject(ProductService);

  // ── Filter state ──────────────────────────────────────────────────────────
  readonly searchRaw   = signal('');
  readonly searchQuery = signal('');   // debounced from searchRaw
  readonly brand       = signal('');
  readonly minPriceRaw = signal('');
  readonly maxPriceRaw = signal('');
  readonly available   = signal(false);
  readonly sortBy      = signal<SortValue>('name_asc');
  readonly offset      = signal(0);

  // ── Data state ────────────────────────────────────────────────────────────
  readonly loading  = signal(true);
  readonly products = signal<Product[]>([]);
  readonly total    = signal(0);

  // ── Constants ─────────────────────────────────────────────────────────────
  readonly PAGE_SIZE  = PAGE_SIZE;
  readonly sortOptions = SORT_OPTIONS;
  readonly skeletons   = Array(8);

  // ── Derived ───────────────────────────────────────────────────────────────
  readonly hasFilters = computed(() =>
    !!this.searchQuery() || !!this.brand() ||
    !!this.minPriceRaw() || !!this.maxPriceRaw() || this.available(),
  );
  readonly pageCount  = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  readonly currentPage = computed(() => Math.floor(this.offset() / PAGE_SIZE) + 1);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-fetch whenever any filter/sort/page signal changes
    effect(() => {
      this.searchQuery(); this.brand(); this.minPriceRaw(); this.maxPriceRaw();
      this.available(); this.sortBy(); this.offset();
      untracked(() => void this.loadProducts());
    });
  }

  ngOnInit(): void {
    // Initial load triggered by effect above
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  onSearchInput(value: string): void {
    this.searchRaw.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.offset.set(0);
      this.searchQuery.set(value.trim());
    }, 350);
  }

  onBrandChange(value: string): void   { this.offset.set(0); this.brand.set(value.trim()); }
  onMinPriceChange(value: string): void { this.offset.set(0); this.minPriceRaw.set(value); }
  onMaxPriceChange(value: string): void { this.offset.set(0); this.maxPriceRaw.set(value); }
  onAvailableChange(value: boolean): void { this.offset.set(0); this.available.set(value); }
  onSortChange(value: SortValue): void { this.offset.set(0); this.sortBy.set(value); }

  clearFilters(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchRaw.set('');
    this.searchQuery.set('');
    this.brand.set('');
    this.minPriceRaw.set('');
    this.maxPriceRaw.set('');
    this.available.set(false);
    this.offset.set(0);
  }

  prevPage(): void { this.offset.update((o) => Math.max(0, o - PAGE_SIZE)); }
  nextPage(): void { this.offset.update((o) => o + PAGE_SIZE); }

  min(a: number, b: number): number { return Math.min(a, b); }

  // ── Data loading ──────────────────────────────────────────────────────────

  private async loadProducts(): Promise<void> {
    this.loading.set(true);

    const minP = parseFloat(this.minPriceRaw());
    const maxP = parseFloat(this.maxPriceRaw());

    try {
      const res = await firstValueFrom(
        this.productSvc.search({
          q:         this.searchQuery() || undefined,
          brand:     this.brand() || undefined,
          minPrice:  isNaN(minP) ? undefined : minP,
          maxPrice:  isNaN(maxP) ? undefined : maxP,
          available: this.available() || undefined,
          sortBy:    this.sortBy(),
          limit:     PAGE_SIZE,
          offset:    this.offset(),
        }),
      );
      this.products.set(res.data);
      this.total.set(res.total);
    } catch {
      this.products.set([]);
      this.total.set(0);
    } finally {
      this.loading.set(false);
    }
  }
}
