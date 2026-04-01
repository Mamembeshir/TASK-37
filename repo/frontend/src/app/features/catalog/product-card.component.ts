import { Component, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '../../core/services/cart.service';
import type { Product } from '../../core/models/product.model';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="card flex flex-col overflow-hidden group">

      <!-- Thumbnail placeholder -->
      <a [routerLink]="['/catalog', product.id]"
         class="block h-40 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center
                border-b border-zinc-200 overflow-hidden">
        <svg class="w-12 h-12 text-zinc-700 group-hover:text-zinc-800 transition-colors"
             fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      </a>

      <!-- Body -->
      <div class="flex flex-col flex-1 p-4 gap-3">

        <!-- Brand -->
        @if (product.brand) {
          <p class="text-xs font-medium text-zinc-700 uppercase tracking-widest truncate">
            {{ product.brand }}
          </p>
        }

        <!-- Name -->
        <a [routerLink]="['/catalog', product.id]"
           class="text-sm font-semibold text-zinc-900 leading-snug line-clamp-2
                  hover:text-[#c4832a] transition-colors">
          {{ product.name }}
        </a>

        <!-- Price + stock -->
        <div class="flex items-center justify-between mt-auto">
          <span class="text-lg font-bold text-[#c4832a]">
            {{ '$' + product.price }}
          </span>
          @if (product.stockQty > 0) {
            <span class="badge badge-green text-[10px]">In stock</span>
          } @else {
            <span class="badge badge-red text-[10px]">Out of stock</span>
          }
        </div>

        <!-- Add to cart -->
        <button
          type="button"
          class="btn-primary w-full py-2 text-sm flex items-center justify-center gap-2
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          [disabled]="product.stockQty <= 0 || cart.addingProductId() === product.id"
          (click)="addToCart()"
        >
          @if (cart.addingProductId() === product.id) {
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
    </div>
  `,
})
export class ProductCardComponent {
  @Input({ required: true }) product!: Product;

  protected readonly cart = inject(CartService);

  addToCart(): void {
    void this.cart.addToCart(this.product.id);
  }
}
