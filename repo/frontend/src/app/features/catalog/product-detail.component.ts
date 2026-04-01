import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../../core/services/product.service';
import { CartService } from '../../core/services/cart.service';
import type { Product } from '../../core/models/product.model';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="mx-auto max-w-4xl px-4 sm:px-6 py-8 animate-fade-in">

      <!-- Back link -->
      <a routerLink="/catalog"
         class="inline-flex items-center gap-1.5 text-sm text-zinc-700 hover:text-zinc-700
                transition-colors mb-6">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Back to Catalog
      </a>

      <!-- Loading skeleton -->
      @if (loading()) {
        <div class="card p-6 sm:p-8 flex flex-col sm:flex-row gap-8">
          <div class="shimmer w-full sm:w-64 h-64 rounded-xl shrink-0"></div>
          <div class="flex-1 space-y-4">
            <div class="shimmer h-5 w-1/4 rounded"></div>
            <div class="shimmer h-7 w-3/4 rounded"></div>
            <div class="shimmer h-10 w-1/3 rounded"></div>
            <div class="shimmer h-4 w-full rounded"></div>
            <div class="shimmer h-4 w-5/6 rounded"></div>
            <div class="shimmer h-12 w-40 rounded-xl mt-4"></div>
          </div>
        </div>
      }

      <!-- Error -->
      @if (!loading() && error()) {
        <div class="card p-8 text-center">
          <p class="text-zinc-700 mb-4">{{ error() }}</p>
          <a routerLink="/catalog" class="btn-secondary inline-block">Back to Catalog</a>
        </div>
      }

      <!-- Product -->
      @if (!loading() && product()) {
        <div class="card p-6 sm:p-8 flex flex-col sm:flex-row gap-8">

          <!-- Image placeholder -->
          <div class="w-full sm:w-64 h-64 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900
                      flex items-center justify-center border border-zinc-200 shrink-0">
            <svg class="w-20 h-20 text-zinc-700" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
          </div>

          <!-- Info -->
          <div class="flex-1 flex flex-col gap-4">

            @if (product()!.brand) {
              <p class="text-xs font-semibold uppercase tracking-widest text-zinc-700">
                {{ product()!.brand }}
              </p>
            }

            <h1 class="text-2xl font-bold text-zinc-900 leading-snug">{{ product()!.name }}</h1>

            <div class="flex items-center gap-3">
              <span class="text-3xl font-bold text-[#c4832a]">{{ '$' + product()!.price }}</span>
              @if (product()!.stockQty > 0) {
                <span class="badge badge-green">{{ product()!.stockQty }} in stock</span>
              } @else {
                <span class="badge badge-red">Out of stock</span>
              }
            </div>

            @if (product()!.category) {
              <p class="text-xs text-zinc-700">
                Category: <span class="text-zinc-700">{{ product()!.category }}</span>
              </p>
            }

            @if (product()!.description) {
              <p class="text-sm text-zinc-700 leading-relaxed">{{ product()!.description }}</p>
            }

            <!-- Qty + Add to cart -->
            @if (product()!.stockQty > 0) {
              <div class="flex items-center gap-3 mt-2">
                <!-- Quantity picker -->
                <div class="flex items-center border border-zinc-200 rounded-lg overflow-hidden bg-zinc-100">
                  <button type="button"
                    (click)="decQty()"
                    [disabled]="qty <= 1"
                    class="px-3 py-2 text-zinc-700 hover:text-zinc-900 hover:bg-white/5
                           transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
                    </svg>
                  </button>
                  <span class="px-4 py-2 text-sm font-semibold text-zinc-900 min-w-[2.5rem] text-center">
                    {{ qty }}
                  </span>
                  <button type="button"
                    (click)="incQty()"
                    [disabled]="qty >= product()!.stockQty"
                    class="px-3 py-2 text-zinc-700 hover:text-zinc-900 hover:bg-white/5
                           transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </button>
                </div>

                <!-- Add to cart button -->
                <button
                  type="button"
                  class="btn-primary flex items-center gap-2
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                  [disabled]="cart.addingProductId() === product()!.id"
                  (click)="addToCart()"
                >
                  @if (cart.addingProductId() === product()!.id) {
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                    Adding...
                  } @else {
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                    </svg>
                    Add to Cart
                  }
                </button>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ProductDetailComponent implements OnInit {
  private readonly route      = inject(ActivatedRoute);
  private readonly productSvc = inject(ProductService);
  protected readonly cart     = inject(CartService);

  readonly loading = signal(true);
  readonly product = signal<Product | null>(null);
  readonly error   = signal<string | null>(null);

  qty = 1;

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.error.set('Invalid product ID'); this.loading.set(false); return; }

    try {
      const p = await firstValueFrom(this.productSvc.getById(id));
      this.product.set(p);
    } catch {
      this.error.set('Product not found');
    } finally {
      this.loading.set(false);
    }
  }

  incQty(): void { if (this.qty < (this.product()?.stockQty ?? 1)) this.qty++; }
  decQty(): void { if (this.qty > 1) this.qty--; }

  addToCart(): void {
    const p = this.product();
    if (p) void this.cart.addToCart(p.id, this.qty);
  }
}
